export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    Object.assign(this, extra)
  }
}

const NASA_API_HOST = 'api.nasa.gov'
// Sans en-tête Retry-After, on suspend les appels à api.nasa.gov pendant cette durée après un 429.
const DEFAULT_RATE_LIMIT_PAUSE_S = 300

const rateLimit = { limit: null, remaining: null, updatedAt: null, blockedUntil: 0 }

export function getRateLimit() {
  const blockedFor = Math.max(0, Math.ceil((rateLimit.blockedUntil - Date.now()) / 1000))
  return {
    limit: rateLimit.limit,
    remaining: rateLimit.remaining,
    updatedAt: rateLimit.updatedAt,
    blockedForSeconds: blockedFor,
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const redact = (url) => String(url).replace(/api_key=[^&]+/i, 'api_key=***')

function parseRetryAfter(res) {
  const header = res.headers.get('retry-after')
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds)
  const date = Date.parse(header)
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000))
}

function trackRateLimit(res) {
  const limit = Number(res.headers.get('x-ratelimit-limit'))
  const remaining = Number(res.headers.get('x-ratelimit-remaining'))
  if (res.headers.has('x-ratelimit-remaining') && Number.isFinite(remaining)) {
    rateLimit.limit = Number.isFinite(limit) ? limit : rateLimit.limit
    rateLimit.remaining = remaining
    rateLimit.updatedAt = new Date().toISOString()
  }
}

/**
 * fetch vers une API amont avec délai maximal, nouvelles tentatives (backoff exponentiel
 * sur erreurs réseau / 5xx) et gestion du rate limiting (429 + Retry-After).
 * Résout avec une Response `ok`, sinon rejette avec une HttpError.
 */
export async function fetchUpstream(url, { timeoutMs = 15000, retries = 2, headers } = {}) {
  const isNasaApi = new URL(url).hostname === NASA_API_HOST

  if (isNasaApi && Date.now() < rateLimit.blockedUntil) {
    throw new HttpError(429, 'Quota de la clé NASA API atteint, nouvelle tentative plus tard.', {
      retryAfter: Math.ceil((rateLimit.blockedUntil - Date.now()) / 1000),
    })
  }

  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await sleep(Math.min(4000, 400 * 2 ** (attempt - 1)) + Math.random() * 200)
    }

    let res
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
    } catch (err) {
      const timedOut = err.name === 'TimeoutError'
      lastError = new HttpError(
        timedOut ? 504 : 502,
        timedOut
          ? `Délai dépassé (${timeoutMs} ms) pour ${redact(url)}`
          : `Service amont injoignable : ${redact(url)}`,
      )
      continue
    }

    if (isNasaApi) trackRateLimit(res)
    if (res.ok) return res

    await res.body?.cancel()

    if (res.status === 429) {
      const retryAfter = parseRetryAfter(res) ?? DEFAULT_RATE_LIMIT_PAUSE_S
      if (retryAfter <= 3 && attempt < retries) {
        await sleep(retryAfter * 1000)
        continue
      }
      if (isNasaApi) rateLimit.blockedUntil = Date.now() + retryAfter * 1000
      throw new HttpError(429, 'Quota de requêtes dépassé sur le service amont.', { retryAfter })
    }

    if (res.status >= 500) {
      lastError = new HttpError(502, `Erreur ${res.status} du service amont : ${redact(url)}`)
      continue
    }

    if (res.status === 401 || res.status === 403) {
      throw new HttpError(
        502,
        isNasaApi
          ? 'Clé NASA_API_KEY refusée par api.nasa.gov (vérifiez sa valeur).'
          : `Accès refusé par le service amont : ${redact(url)}`,
      )
    }

    throw new HttpError(res.status === 404 ? 404 : 400, `Réponse ${res.status} du service amont : ${redact(url)}`)
  }

  throw lastError
}

export async function fetchJson(url, options) {
  const res = await fetchUpstream(url, options)
  try {
    return await res.json()
  } catch {
    throw new HttpError(502, `Réponse JSON invalide : ${redact(url)}`)
  }
}

/** Exécute `worker` sur chaque élément avec au plus `limit` appels simultanés. */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  const run = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}
