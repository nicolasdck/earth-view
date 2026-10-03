import { config } from '../config.js'
import { TtlCache } from '../lib/cache.js'
import { HttpError, fetchJson, fetchUpstream } from '../lib/http.js'
import { addDays, todayISO } from '../lib/validate.js'

const EARTH_API = 'https://api.nasa.gov/planetary/earth'
const CMR_GRANULES = 'https://cmr.earthdata.nasa.gov/search/granules.json'
const GIBS_WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi'
const HLS_LAYER = 'HLS_L30_Nadir_BRDF_Adjusted_Reflectance'
const HLS_FIRST_DATE = '2013-04-11'

export const SOURCE_EARTH_API = 'earth-api'
export const SOURCE_HLS = 'hls'

const SEARCH_WINDOW_DAYS = 45
const CLEAR_SKY_MAX_CLOUD = 30
const HOUR = 60 * 60 * 1000

const assetCache = new TtlCache({ maxEntries: 300 })
const imageCache = new TtlCache({ maxEntries: 40 })

// Disjoncteur : l'API Earth Imagery (Landsat 8) est régulièrement indisponible.
// Après un échec on ne la sollicite plus pendant 10 minutes, pour ne pas faire
// attendre chaque requête jusqu'au délai maximal avant de basculer sur GIBS.
const EARTH_API_COOLDOWN_MS = 10 * 60 * 1000
let earthApiDownUntil = 0

async function tryEarthApi(call) {
  if (Date.now() < earthApiDownUntil) return null
  try {
    return await call()
  } catch (err) {
    if (err.status !== 404 && err.status !== 400) earthApiDownUntil = Date.now() + EARTH_API_COOLDOWN_MS
    return null
  }
}

function earthApiUrl(endpoint, { lat, lon, date, dim }) {
  const params = new URLSearchParams({
    lon: String(lon),
    lat: String(lat),
    date,
    dim: String(dim),
    api_key: config.nasaApiKey,
  })
  return `${EARTH_API}/${endpoint}?${params}`
}

const round = (value, digits = 4) => Number(value.toFixed(digits))

function dayDistance(a, b) {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000
}

/** Passages Landsat 8/9 (produit HLS L30) au-dessus du point, autour de la date demandée. */
async function findHlsPasses({ lat, lon, date }) {
  const today = todayISO()
  const start = addDays(date, -SEARCH_WINDOW_DAYS) < HLS_FIRST_DATE ? HLS_FIRST_DATE : addDays(date, -SEARCH_WINDOW_DAYS)
  const end = addDays(date, SEARCH_WINDOW_DAYS) > today ? today : addDays(date, SEARCH_WINDOW_DAYS)
  if (start > end) return []

  const params = new URLSearchParams({
    short_name: 'HLSL30',
    point: `${lon},${lat}`,
    temporal: `${start}T00:00:00Z,${end}T23:59:59Z`,
    sort_key: '-start_date',
    page_size: '200',
  })
  const data = await fetchJson(`${CMR_GRANULES}?${params}`, { timeoutMs: 15000, retries: 1 })

  // Plusieurs tuiles peuvent couvrir le point le même jour : on garde la moins nuageuse.
  const byDay = new Map()
  for (const granule of data.feed?.entry ?? []) {
    const day = granule.time_start?.slice(0, 10)
    if (!day) continue
    const cloud = granule.cloud_cover === undefined ? null : Number(granule.cloud_cover)
    const known = byDay.get(day)
    if (!known || (cloud !== null && (known.cloudCover === null || cloud < known.cloudCover))) {
      byDay.set(day, { date: day, cloudCover: cloud })
    }
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function pickPass(passes, date) {
  const nearest = (list) =>
    list.reduce((best, pass) => (dayDistance(pass.date, date) < dayDistance(best.date, date) ? pass : best))
  const clear = passes.filter((pass) => pass.cloudCover !== null && pass.cloudCover <= CLEAR_SKY_MAX_CLOUD)
  return nearest(clear.length > 0 ? clear : passes)
}

function imageUrl({ lat, lon, date, dim, source }) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), date, dim: String(dim), source })
  return `/api/earth/imagery?${params}`
}

/**
 * Résout l'acquisition Landsat la plus pertinente pour un point et une date :
 * d'abord via l'API Earth Imagery de la NASA, sinon via le catalogue CMR (HLS Landsat 30 m).
 */
export function resolveAsset({ lat, lon, date, dim }) {
  const query = { lat: round(lat), lon: round(lon), date, dim: round(dim, 3) }
  const key = `asset:${query.lat}:${query.lon}:${query.date}:${query.dim}`

  return assetCache.wrap(key, 6 * HOUR, async () => {
    const half = query.dim / 2
    const base = {
      requested: query,
      bbox: {
        south: round(query.lat - half),
        west: round(query.lon - half),
        north: round(query.lat + half),
        east: round(query.lon + half),
      },
    }

    const asset = await tryEarthApi(() => fetchJson(earthApiUrl('assets', query), { timeoutMs: 8000, retries: 0 }))
    if (asset?.date) {
      const resolved = asset.date.slice(0, 10)
      return {
        ...base,
        source: SOURCE_EARTH_API,
        sourceLabel: 'NASA Earth Imagery API (Landsat 8)',
        date: resolved,
        cloudCover: null,
        passes: [],
        imageUrl: imageUrl({ ...query, date: resolved, source: SOURCE_EARTH_API }),
      }
    }

    const passes = await findHlsPasses(query)
    if (passes.length === 0) {
      throw new HttpError(
        404,
        `Aucune acquisition Landsat trouvée à ±${SEARCH_WINDOW_DAYS} jours du ${date} pour ce point (données disponibles depuis ${HLS_FIRST_DATE}, terres émergées uniquement).`,
      )
    }
    const pass = pickPass(passes, date)
    return {
      ...base,
      source: SOURCE_HLS,
      sourceLabel: 'GIBS — HLS Landsat 8/9 (30 m)',
      date: pass.date,
      cloudCover: pass.cloudCover,
      passes,
      imageUrl: imageUrl({ ...query, date: pass.date, source: SOURCE_HLS }),
    }
  })
}

async function fetchImage(url, options) {
  const res = await fetchUpstream(url, options)
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/')) {
    await res.body?.cancel()
    throw new HttpError(502, 'Le service amont n’a pas renvoyé une image.')
  }
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType }
}

function gibsSnapshotUrl({ lat, lon, date, dim }) {
  const half = dim / 2
  // En EPSG:4326 un degré de longitude est plus court qu'un degré de latitude :
  // on réduit la largeur en pixels pour que l'image ne soit pas étirée.
  const height = 1024
  const width = Math.max(256, Math.round(height * Math.cos((lat * Math.PI) / 180)))
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    LAYERS: HLS_LAYER,
    STYLES: '',
    FORMAT: 'image/jpeg',
    CRS: 'EPSG:4326',
    BBOX: [lat - half, lon - half, lat + half, lon + half].join(','),
    WIDTH: String(width),
    HEIGHT: String(height),
    TIME: date,
  })
  return `${GIBS_WMS}?${params}`
}

/** Image centrée sur le point : { buffer, contentType, source }. */
export function getImage({ lat, lon, date, dim, source }) {
  const query = { lat: round(lat), lon: round(lon), date, dim: round(dim, 3) }
  const key = `image:${source}:${query.lat}:${query.lon}:${query.date}:${query.dim}`

  return imageCache.wrap(key, 24 * HOUR, async () => {
    if (source !== SOURCE_HLS) {
      const image = await tryEarthApi(() => fetchImage(earthApiUrl('imagery', query), { timeoutMs: 20000, retries: 0 }))
      if (image) return { ...image, source: SOURCE_EARTH_API }
    }
    const image = await fetchImage(gibsSnapshotUrl(query), { timeoutMs: 30000, retries: 1 })
    return { ...image, source: SOURCE_HLS }
  })
}

export function cacheInfo() {
  return { assets: assetCache.info(), images: imageCache.info() }
}
