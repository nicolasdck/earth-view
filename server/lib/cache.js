/**
 * Cache mémoire TTL + LRU avec :
 *  - déduplication des requêtes concurrentes (une seule requête amont par clé),
 *  - repli sur la valeur périmée si l'amont échoue (stale-if-error).
 */
export class TtlCache {
  constructor({ maxEntries = 500 } = {}) {
    this.maxEntries = maxEntries
    this.entries = new Map()
    this.inflight = new Map()
    this.stats = { hits: 0, misses: 0, stale: 0 }
  }

  get(key) {
    const entry = this.entries.get(key)
    if (!entry || entry.expiresAt <= Date.now()) return undefined
    // Réinsertion en fin de Map : l'entrée redevient la plus récemment utilisée.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key, value, ttlMs) {
    this.entries.delete(key)
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs })
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value)
    }
  }

  /**
   * @param {string} key
   * @param {number | ((value: any) => number)} ttlMs durée fixe ou calculée à partir de la valeur
   * @param {() => Promise<any>} producer
   */
  wrap(key, ttlMs, producer) {
    const cached = this.get(key)
    if (cached !== undefined) {
      this.stats.hits++
      return Promise.resolve(cached)
    }

    const pending = this.inflight.get(key)
    if (pending) return pending

    this.stats.misses++
    const promise = (async () => {
      try {
        const value = await producer()
        this.set(key, value, typeof ttlMs === 'function' ? ttlMs(value) : ttlMs)
        return value
      } catch (err) {
        const stale = this.entries.get(key)
        if (stale) {
          this.stats.stale++
          return stale.value
        }
        throw err
      } finally {
        this.inflight.delete(key)
      }
    })()

    this.inflight.set(key, promise)
    return promise
  }

  info() {
    return { size: this.entries.size, ...this.stats }
  }
}
