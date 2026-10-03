import { Router } from 'express'
import { parseDate, parseNumber, todayISO } from '../lib/validate.js'
import { assertCollection, getAvailableDates, getDailySeries, getImagesByDate, getLatest } from '../services/epic.js'

const router = Router()

router.param('collection', (req, _res, next, collection) => {
  assertCollection(collection)
  next()
})

router.get('/:collection/dates', async (req, res) => {
  const dates = await getAvailableDates(req.params.collection)
  res.set('Cache-Control', 'public, max-age=600, s-maxage=600, stale-while-revalidate=86400')
  res.json({ collection: req.params.collection, dates })
})

router.get('/:collection/latest', async (req, res) => {
  const latest = await getLatest(req.params.collection)
  res.set('Cache-Control', 'public, max-age=600, s-maxage=600, stale-while-revalidate=86400')
  res.json({ collection: req.params.collection, ...latest })
})

router.get('/:collection/date/:date', async (req, res) => {
  const date = parseDate(req.params.date, 'date')
  const images = await getImagesByDate(req.params.collection, date)
  res.set('Cache-Control', 'public, max-age=1800, s-maxage=1800, stale-while-revalidate=86400')
  res.json({ collection: req.params.collection, date, images })
})

router.get('/:collection/series', async (req, res) => {
  const end = parseDate(req.query.end, 'end', { fallback: todayISO() })
  const days = parseNumber(req.query.days, 'days', { min: 2, max: 60, fallback: 14, integer: true })
  const lon = parseNumber(req.query.lon, 'lon', { min: -180, max: 180, fallback: 0 })
  const images = await getDailySeries(req.params.collection, { end, days, lon })
  res.set('Cache-Control', 'public, max-age=1800, s-maxage=1800, stale-while-revalidate=86400')
  res.json({ collection: req.params.collection, end, days, lon, images })
})

export default router
