import { TtlCache } from '../lib/cache.js'
import { fetchJson } from '../lib/http.js'

const EONET_EVENTS = 'https://eonet.gsfc.nasa.gov/api/v3/events'
const FIFTEEN_MINUTES = 15 * 60 * 1000

const cache = new TtlCache({ maxEntries: 20 })

const CATEGORY_LABELS = {
  wildfires: 'Feux de forêt',
  severeStorms: 'Tempêtes et cyclones',
  volcanoes: 'Volcans',
  seaLakeIce: 'Glaces et icebergs',
  floods: 'Inondations',
  earthquakes: 'Séismes',
  drought: 'Sécheresses',
  dustHaze: 'Poussières et brumes',
  landslides: 'Glissements de terrain',
  snow: 'Neige',
  tempExtremes: 'Températures extrêmes',
  waterColor: 'Couleur de l’eau',
  manmade: 'Origine humaine',
}

/** Position représentative d'une géométrie EONET : le point lui-même, ou le premier sommet d'un polygone. */
function positionOf(geometry) {
  let coordinates = geometry?.coordinates
  while (Array.isArray(coordinates) && Array.isArray(coordinates[0])) coordinates = coordinates[0]
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null
  const [lon, lat] = coordinates
  return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat } : null
}

function normalizeEvent(event) {
  // Un événement suivi dans le temps (cyclone, iceberg) a plusieurs positions : on garde la dernière.
  const geometries = [...(event.geometry ?? [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const latest = geometries[geometries.length - 1]
  const position = positionOf(latest)
  if (!position) return null

  const category = event.categories?.[0]?.id ?? 'other'
  return {
    id: event.id,
    title: event.title,
    category,
    categoryLabel: CATEGORY_LABELS[category] ?? event.categories?.[0]?.title ?? 'Autre',
    date: latest.date,
    firstDate: geometries[0].date,
    lat: position.lat,
    lon: position.lon,
    magnitude:
      typeof latest.magnitudeValue === 'number' ? { value: latest.magnitudeValue, unit: latest.magnitudeUnit ?? '' } : null,
    positions: geometries.length,
    sourceUrl: event.sources?.[0]?.url ?? null,
  }
}

/** Événements naturels en cours, observés au moins une fois durant les `days` derniers jours. */
export function getEvents({ days }) {
  return cache.wrap(`events:${days}`, FIFTEEN_MINUTES, async () => {
    const params = new URLSearchParams({ status: 'open', days: String(days) })
    const data = await fetchJson(`${EONET_EVENTS}?${params}`, { timeoutMs: 20000, retries: 1 })
    const events = (data.events ?? [])
      .map(normalizeEvent)
      .filter(Boolean)
      .sort((a, b) => b.date.localeCompare(a.date))
    return { days, events }
  })
}

export function cacheInfo() {
  return cache.info()
}
