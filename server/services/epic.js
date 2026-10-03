import { config } from '../config.js'
import { TtlCache } from '../lib/cache.js'
import { HttpError, fetchJson, mapLimit } from '../lib/http.js'
import { addDays, todayISO } from '../lib/validate.js'

export const EPIC_COLLECTIONS = ['natural', 'enhanced']

const ARCHIVE_BASE = 'https://epic.gsfc.nasa.gov/archive'
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const cache = new TtlCache({ maxEntries: 800 })

// Deux points d'accès servent les mêmes métadonnées : api.nasa.gov (clé requise, quota)
// et le miroir public du GSFC (sans clé). Avec DEMO_KEY (30 requêtes/heure) on privilégie
// le miroir ; avec une clé personnelle on passe d'abord par api.nasa.gov.
const sources = {
  nasa: (path) => `https://api.nasa.gov/EPIC/api/${path}?api_key=${encodeURIComponent(config.nasaApiKey)}`,
  mirror: (path) => `https://epic.gsfc.nasa.gov/api/${path}`,
}

async function fetchEpic(path) {
  const order = config.isDemoKey ? ['mirror', 'nasa'] : ['nasa', 'mirror']
  let firstError
  for (const name of order) {
    try {
      return await fetchJson(sources[name](path), { timeoutMs: 12000, retries: 1 })
    } catch (err) {
      firstError ??= err
    }
  }
  throw firstError
}

export function assertCollection(collection) {
  if (!EPIC_COLLECTIONS.includes(collection)) {
    throw new HttpError(400, `Collection EPIC inconnue : « ${collection} » (natural ou enhanced).`)
  }
  return collection
}

function normalizeImage(collection, item) {
  const [day, time] = item.date.split(' ')
  const [year, month, dayOfMonth] = day.split('-')
  const folder = `${ARCHIVE_BASE}/${collection}/${year}/${month}/${dayOfMonth}`
  const centroid = item.centroid_coordinates ?? {}
  return {
    identifier: item.identifier,
    image: item.image,
    caption: item.caption,
    date: `${day}T${time}Z`,
    centroid: { lat: centroid.lat ?? null, lon: centroid.lon ?? null },
    urls: {
      thumb: `${folder}/thumbs/${item.image}.jpg`,
      jpg: `${folder}/jpg/${item.image}.jpg`,
      png: `${folder}/png/${item.image}.png`,
    },
  }
}

/** Dates disponibles, de la plus récente à la plus ancienne. */
export function getAvailableDates(collection) {
  return cache.wrap(`dates:${collection}`, HOUR, async () => {
    const data = await fetchEpic(`${collection}/all`)
    return data
      .map((entry) => entry.date)
      .filter(Boolean)
      .sort()
      .reverse()
  })
}

/** Images d'une journée, triées par heure de prise de vue. */
export function getImagesByDate(collection, date) {
  // Une journée ancienne ne change plus ; les jours récents peuvent encore recevoir des images.
  const ttl = date >= addDays(todayISO(), -3) ? HOUR / 2 : 7 * DAY
  return cache.wrap(`day:${collection}:${date}`, ttl, async () => {
    const data = await fetchEpic(`${collection}/date/${date}`)
    return data.map((item) => normalizeImage(collection, item)).sort((a, b) => a.date.localeCompare(b.date))
  })
}

export async function getLatest(collection) {
  const dates = await getAvailableDates(collection)
  if (dates.length === 0) throw new HttpError(404, 'Aucune image EPIC disponible.')
  return { date: dates[0], images: await getImagesByDate(collection, dates[0]) }
}

function longitudeGap(a, b) {
  const diff = Math.abs(a - b) % 360
  return diff > 180 ? 360 - diff : diff
}

/**
 * Une image par jour sur les `days` derniers jours disponibles jusqu'à `end`,
 * en choisissant chaque jour la vue dont le centre est le plus proche de `lon`
 * (même face de la Terre d'un jour à l'autre).
 */
export async function getDailySeries(collection, { end, days, lon }) {
  const dates = (await getAvailableDates(collection)).filter((date) => date <= end).slice(0, days)
  const perDay = await mapLimit(dates, 4, async (date) => {
    try {
      const images = await getImagesByDate(collection, date)
      if (images.length === 0) return null
      return images.reduce((best, image) =>
        longitudeGap(image.centroid.lon ?? 0, lon) < longitudeGap(best.centroid.lon ?? 0, lon) ? image : best,
      )
    } catch {
      return null
    }
  })
  return perDay.filter(Boolean).reverse()
}

/** Préchauffe le cache au démarrage pour que le premier affichage soit immédiat. */
export async function warmUp() {
  await getLatest('natural')
}

export function cacheInfo() {
  return cache.info()
}
