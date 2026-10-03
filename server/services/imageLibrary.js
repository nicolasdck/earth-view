import { TtlCache } from '../lib/cache.js'
import { HttpError, fetchJson } from '../lib/http.js'

const IMAGES_API = 'https://images-api.nasa.gov'
const DETAILS_PAGE = 'https://images.nasa.gov/details'
const HOUR = 60 * 60 * 1000
// L'API refuse de paginer au-delà de 10 000 résultats.
export const MAX_RESULTS = 10000

const cache = new TtlCache({ maxEntries: 400 })

const https = (url) => url.replace(/^http:\/\//, 'https://')

const ENTITIES = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' }

/** Les descriptions contiennent du HTML : on n'en garde que le texte. */
function plainText(html) {
  if (typeof html !== 'string') return ''
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|quot|#39|lt|gt|nbsp);/g, (entity) => ENTITIES[entity])
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeItem(item) {
  const data = item.data?.[0]
  const thumb = item.links?.find((link) => link.render === 'image' || link.rel === 'preview')?.href
  if (!data?.nasa_id || !thumb) return null
  return {
    id: data.nasa_id,
    title: data.title ?? data.nasa_id,
    description: plainText(data.description),
    date: data.date_created ?? null,
    center: data.center ?? null,
    photographer: data.photographer ?? data.secondary_creator ?? null,
    location: data.location ?? null,
    keywords: Array.isArray(data.keywords) ? data.keywords.slice(0, 12) : [],
    thumb: https(thumb),
    detailsUrl: `${DETAILS_PAGE}/${encodeURIComponent(data.nasa_id)}`,
  }
}

/** Recherche de photographies dans la NASA Image and Video Library. */
export function searchImages({ query, page, pageSize, yearStart, yearEnd }) {
  if (page * pageSize > MAX_RESULTS) {
    throw new HttpError(400, `La photothèque ne permet pas d’aller au-delà de ${MAX_RESULTS} résultats : affinez la recherche.`)
  }
  const params = new URLSearchParams({
    q: query,
    media_type: 'image',
    page: String(page),
    page_size: String(pageSize),
  })
  if (yearStart) params.set('year_start', String(yearStart))
  if (yearEnd) params.set('year_end', String(yearEnd))

  return cache.wrap(`search:${params}`, HOUR, async () => {
    const data = await fetchJson(`${IMAGES_API}/search?${params}`, { timeoutMs: 20000, retries: 1 })
    const collection = data.collection ?? {}
    return {
      hits: collection.metadata?.total_hits ?? 0,
      page,
      pageSize,
      items: (collection.items ?? []).map(normalizeItem).filter(Boolean),
    }
  })
}

/** Fichiers disponibles pour une image (toutes les tailles n'existent pas pour chaque image). */
export function getImageFiles(id) {
  return cache.wrap(`asset:${id}`, 24 * HOUR, async () => {
    const data = await fetchJson(`${IMAGES_API}/asset/${encodeURIComponent(id)}`, { timeoutMs: 15000, retries: 1 })
    const urls = (data.collection?.items ?? []).map((item) => https(item.href))
    const bySize = (size) => urls.find((url) => new RegExp(`~${size}\\.(jpe?g|png|gif)$`, 'i').test(url)) ?? null

    const original = bySize('orig')
    const large = bySize('large')
    const medium = bySize('medium')
    const small = bySize('small')
    return {
      id,
      // Meilleure taille pour un affichage plein écran sans télécharger l'original (souvent > 10 Mo).
      display: large ?? medium ?? small ?? original,
      original,
    }
  })
}

export function cacheInfo() {
  return cache.info()
}
