export class ApiError extends Error {
  status: number
  retryAfter: number | null

  constructor(status: number, message: string, retryAfter: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retryAfter = retryAfter
  }
}

type Params = Record<string, string | number | boolean | null | undefined>

export function buildUrl(path: string, params: Params = {}) {
  const search = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(name, String(value))
  }
  const query = search.toString()
  return `/api${path}${query ? `?${query}` : ''}`
}

async function get<T>(path: string, params?: Params, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(buildUrl(path, params), { signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, 'Serveur API injoignable. Vérifiez que le backend est démarré (npm run dev).')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ApiError(
      res.status,
      body?.error?.message ?? `Erreur ${res.status}`,
      body?.error?.retryAfter ?? null,
    )
  }
  return res.json() as Promise<T>
}

/* ---------- EPIC ---------- */

export type EpicCollection = 'natural' | 'enhanced'

export interface EpicImage {
  identifier: string
  image: string
  caption: string
  date: string
  centroid: { lat: number | null; lon: number | null }
  urls: { thumb: string; jpg: string; png: string }
}

export interface EpicDates {
  collection: EpicCollection
  dates: string[]
}

export interface EpicDay {
  collection: EpicCollection
  date: string
  images: EpicImage[]
}

export interface EpicSeries {
  collection: EpicCollection
  end: string
  days: number
  lon: number
  images: EpicImage[]
}

/* ---------- Earth Imagery (Landsat) ---------- */

export type ImagerySource = 'earth-api' | 'hls'

export interface LandsatPass {
  date: string
  cloudCover: number | null
}

export interface EarthAsset {
  requested: { lat: number; lon: number; date: string; dim: number }
  bbox: { south: number; west: number; north: number; east: number }
  source: ImagerySource
  sourceLabel: string
  date: string
  cloudCover: number | null
  passes: LandsatPass[]
  imageUrl: string
}

export interface EarthQuery {
  lat: number
  lon: number
  date: string
  dim: number
}

/* ---------- GIBS ---------- */

export interface GibsLayer {
  id: string
  title: string
  description: string
  kind: 'base' | 'overlay' | 'reference'
  service: 'wmts' | 'wms'
  format: string
  level: number
  start: string | null
  url: string
}

/* ---------- Earthdata (CMR) ---------- */

export interface Paged<T> {
  hits: number
  page: number
  pageSize: number
  items: T[]
}

export interface EarthdataCollection {
  id: string
  shortName: string
  version: string | null
  title: string
  summary: string
  dataCenter: string | null
  organizations: string[]
  platforms: string[]
  processingLevel: string | null
  timeStart: string | null
  timeEnd: string | null
  cloudHosted: boolean
  thumbnail: string | null
  infoUrl: string | null
  earthdataSearchUrl: string
}

export interface EarthdataGranule {
  id: string
  title: string
  timeStart: string | null
  timeEnd: string | null
  cloudCover: number | null
  dayNight: string | null
  sizeMB: number | null
  browseUrl: string | null
  dataUrl: string | null
}

export interface CollectionSearch {
  keyword: string
  page: number
  pageSize: number
  start?: string
  end?: string
  bbox?: string
  cloudHosted?: boolean
}

/* ---------- Événements naturels (EONET) ---------- */

export interface NaturalEvent {
  id: string
  title: string
  category: string
  categoryLabel: string
  date: string
  firstDate: string
  lat: number
  lon: number
  magnitude: { value: number; unit: string } | null
  positions: number
  sourceUrl: string | null
}

/* ---------- Photothèque NASA ---------- */

export interface LibraryImage {
  id: string
  title: string
  description: string
  date: string | null
  center: string | null
  photographer: string | null
  location: string | null
  keywords: string[]
  thumb: string
  detailsUrl: string
}

export interface ImageFiles {
  id: string
  display: string | null
  original: string | null
}

export interface ImageSearch {
  q: string
  page: number
  pageSize: number
  yearStart?: number
  yearEnd?: number
}

/* ---------- Statut ---------- */

export interface ApiStatus {
  apiKey: 'demo' | 'custom'
  rateLimit: {
    limit: number | null
    remaining: number | null
    updatedAt: string | null
    blockedForSeconds: number
  }
}

export const api = {
  status: (signal?: AbortSignal) => get<ApiStatus>('/status', undefined, signal),

  epicDates: (collection: EpicCollection, signal?: AbortSignal) =>
    get<EpicDates>(`/epic/${collection}/dates`, undefined, signal),
  epicDay: (collection: EpicCollection, date: string, signal?: AbortSignal) =>
    get<EpicDay>(`/epic/${collection}/date/${date}`, undefined, signal),
  epicSeries: (collection: EpicCollection, end: string, days: number, lon: number, signal?: AbortSignal) =>
    get<EpicSeries>(`/epic/${collection}/series`, { end, days, lon }, signal),

  earthAsset: (query: EarthQuery, signal?: AbortSignal) => get<EarthAsset>('/earth/assets', { ...query }, signal),
  earthImageUrl: (query: EarthQuery, source: ImagerySource) => buildUrl('/earth/imagery', { ...query, source }),

  gibsLayers: (signal?: AbortSignal) => get<{ layers: GibsLayer[] }>('/gibs/layers', undefined, signal),

  collections: (search: CollectionSearch, signal?: AbortSignal) =>
    get<Paged<EarthdataCollection>>('/earthdata/collections', { ...search }, signal),
  granules: (collectionId: string, pageSize: number, signal?: AbortSignal) =>
    get<Paged<EarthdataGranule>>(`/earthdata/collections/${collectionId}/granules`, { pageSize }, signal),

  events: (days: number, signal?: AbortSignal) =>
    get<{ days: number; events: NaturalEvent[] }>('/eonet/events', { days }, signal),

  imageSearch: (search: ImageSearch, signal?: AbortSignal) =>
    get<Paged<LibraryImage>>('/images/search', { ...search }, signal),
  imageFiles: (id: string, signal?: AbortSignal) =>
    get<ImageFiles>(`/images/${encodeURIComponent(id)}/files`, undefined, signal),
}
