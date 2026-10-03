import { Router } from 'express'
import { getLayers } from '../services/gibs.js'

const router = Router()

router.get('/layers', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600')
  res.json({ layers: getLayers() })
})

export default router
