import { Router } from 'express'
import { parseNumber } from '../lib/validate.js'
import { getEvents } from '../services/eonet.js'

const router = Router()

router.get('/events', async (req, res) => {
  const days = parseNumber(req.query.days, 'days', { min: 1, max: 365, fallback: 30, integer: true })
  const result = await getEvents({ days })
  res.set('Cache-Control', 'public, max-age=600, s-maxage=600, stale-while-revalidate=86400')
  res.json(result)
})

export default router
