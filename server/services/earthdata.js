import { TtlCache } from '../lib/cache.js'
import { HttpError, fetchUpstream } from '../lib/http.js'

const CMR = 'https://cmr.earthdata.nasa.gov/search'
const EARTHDATA_SEARCH = 'https://search.earthdata.nasa.gov/search/granules'
const TEN_MINUTES = 10 * 60 * 1000

const cache = new TtlCache({ maxEntries: 300 })

const relIs = (link, kind) => typeof link.rel === 'string' && link.rel.endsWith(`/${kind}#`)

async function cmrSearch(resource, params) {
  const url = `${CMR}/${resource}.json?${params}`
  const res = await fetchUpstream(url, { timeoutMs: 20000, retries: 1 })
  const hits = Number(res.headers.get('cmr-hits')) || 0
  try {
    const data = await res.json()
    return { hits, entries: data.feed?.entry ?? [] }
  } catch {
    throw new HttpError(502, 'Réponse CMR invalide.')
  }
}

function temporalParam(start, end) {
  if (!start && !end) return null
  return `${start ? `${start}T00:00:00Z` : ''},${end ? `${end}T23:59:59Z` : ''}`
}

function normalizeCollection(entry) {
  const links = entry.links ?? []
  return {
    id: entry.id,
    shortName: entry.short_name,
    version: entry.version_id ?? null,
    title: entry.title ?? entry.dataset_id,
    summary: entry.summary ?? '',
    dataCenter: entry.data_center ?? null,
    organizations: entry.organizations ?? [],
    platforms: entry.platforms ?? [],
    processingLevel: entry.processing_level_id ?? null,
    timeStart: entry.time_start ?? null,
    timeEnd: entry.time_end ?? null,
    cloudHosted: Boolean(entry.cloud_hosted),
    thumbnail: links.find((link) => relIs(link, 'browse'))?.href ?? null,
    infoUrl: links.find((link) => relIs(link, 'metadata') || relIs(link, 'documentation'))?.href ?? null,
    earthdataSearchUrl: `${EARTHDATA_SEARCH}?p=${encodeURIComponent(entry.id)}`,
  }
}

function normalizeGranule(entry) {
  const links = (entry.links ?? []).filter((link) => !link.inherited)
  const size = Number(entry.granule_size)
  return {
    id: entry.id,
    title: entry.title ?? entry.producer_granule_id,
    timeStart: entry.time_start ?? null,
    timeEnd: entry.time_end ?? null,
    cloudCover: entry.cloud_cover === undefined ? null : Number(entry.cloud_cover),
    dayNight: entry.day_night_flag ?? null,
    sizeMB: Number.isFinite(size) && size > 0 ? size : null,
    browseUrl: links.find((link) => relIs(link, 'browse') && link.href?.startsWith('http'))?.href ?? null,
    dataUrl: links.find((link) => relIs(link, 'data') && link.href?.startsWith('http'))?.href ?? null,
  }
}

/** Recherche de jeux de données (collections) dans le Common Metadata Repository. */
export function searchCollections({ keyword, page, pageSize, start, end, bbox, cloudHosted }) {
  const params = new URLSearchParams({
    page_size: String(pageSize),
    page_num: String(page),
    has_granules: 'true',
  })
  if (keyword) params.set('keyword', keyword)
  // Sans mot-clé il n'y a pas de score de pertinence : on trie par popularité.
  else params.set('sort_key', '-usage_score')
  const temporal = temporalParam(start, end)
  if (temporal) params.set('temporal', temporal)
  if (bbox) params.set('bounding_box', bbox)
  if (cloudHosted) params.set('cloud_hosted', 'true')

  return cache.wrap(`collections:${params}`, TEN_MINUTES, async () => {
    const { hits, entries } = await cmrSearch('collections', params)
    return { hits, page, pageSize, items: entries.map(normalizeCollection) }
  })
}

/** Granules (fichiers) les plus récents d'une collection. */
export function searchGranules({ collectionId, page, pageSize, start, end, bbox }) {
  const params = new URLSearchParams({
    collection_concept_id: collectionId,
    page_size: String(pageSize),
    page_num: String(page),
    sort_key: '-start_date',
  })
  const temporal = temporalParam(start, end)
  if (temporal) params.set('temporal', temporal)
  if (bbox) params.set('bounding_box', bbox)

  return cache.wrap(`granules:${params}`, TEN_MINUTES, async () => {
    const { hits, entries } = await cmrSearch('granules', params)
    return { hits, page, pageSize, items: entries.map(normalizeGranule) }
  })
}

export function cacheInfo() {
  return cache.info()
}
