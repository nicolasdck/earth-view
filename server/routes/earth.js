import { Router } from 'express'
import { HttpError } from '../lib/http.js'
import { parseDate, parseNumber, parseString, todayISO } from '../lib/validate.js'
import { SOURCE_EARTH_API, SOURCE_HLS, getImage, resolveAsset } from '../services/earthImagery.js'

const router = Router()

function parseQuery(query) {
  const date = parseDate(query.date, 'date', { fallback: todayISO() })
  if (date > todayISO()) throw new HttpError(400, 'La date ne peut pas être dans le futur.')
  return {
    lat: parseNumber(query.lat, 'lat', { min: -90, max: 90 }),
    lon: parseNumber(query.lon, 'lon', { min: -180, max: 180 }),
    dim: parseNumber(query.dim, 'dim', { min: 0.01, max: 1, fallback: 0.15 }),
    date,
  }
}

router.get('/assets', async (req, res) => {
  res.json(await resolveAsset(parseQuery(req.query)))
})

router.get('/imagery', async (req, res) => {
  const source = parseString(req.query.source, 'source', { fallback: SOURCE_EARTH_API })
  if (source !== SOURCE_EARTH_API && source !== SOURCE_HLS) {
    throw new HttpError(400, `Paramètre « source » invalide (${SOURCE_EARTH_API} ou ${SOURCE_HLS}).`)
  }
  const image = await getImage({ ...parseQuery(req.query), source })
  res.set({
    'Content-Type': image.contentType,
    'Cache-Control': 'public, max-age=86400',
    'X-Imagery-Source': image.source,
  })
  res.send(image.buffer)
})

export default router
