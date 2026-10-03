import { Router } from 'express'
import { HttpError } from '../lib/http.js'
import { parseNumber, parseString } from '../lib/validate.js'
import { getImageFiles, searchImages } from '../services/imageLibrary.js'

const router = Router()

const NASA_ID = /^[\w.~ -]{1,120}$/
const CURRENT_YEAR = new Date().getUTCFullYear()

function parseYear(value, name) {
  if (value === undefined || value === '') return undefined
  return parseNumber(value, name, { min: 1920, max: CURRENT_YEAR, integer: true })
}

router.get('/search', async (req, res) => {
  const query = parseString(req.query.q, 'q')
  if (!query) throw new HttpError(400, 'Paramètre « q » manquant.')
  const result = await searchImages({
    query,
    page: parseNumber(req.query.page, 'page', { min: 1, max: 1000, fallback: 1, integer: true }),
    pageSize: parseNumber(req.query.pageSize, 'pageSize', { min: 1, max: 100, fallback: 24, integer: true }),
    yearStart: parseYear(req.query.yearStart, 'yearStart'),
    yearEnd: parseYear(req.query.yearEnd, 'yearEnd'),
  })
  res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400')
  res.json(result)
})

router.get('/:id/files', async (req, res) => {
  if (!NASA_ID.test(req.params.id)) throw new HttpError(400, 'Identifiant d’image invalide.')
  const files = await getImageFiles(req.params.id)
  res.set('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=86400')
  res.json(files)
})

export default router
