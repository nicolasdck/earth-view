import { Router } from 'express'
import { HttpError } from '../lib/http.js'
import { parseDate, parseNumber, parseString } from '../lib/validate.js'
import { searchCollections, searchGranules } from '../services/earthdata.js'

const router = Router()

const CONCEPT_ID = /^C\d+-[A-Za-z0-9_]+$/

/** bbox = « ouest,sud,est,nord » en degrés. */
function parseBbox(value) {
  if (value === undefined || value === '') return undefined
  const parts = typeof value === 'string' ? value.split(',').map(Number) : []
  const [west, south, east, north] = parts
  const valid =
    parts.length === 4 &&
    parts.every(Number.isFinite) &&
    west >= -180 &&
    east <= 180 &&
    south >= -90 &&
    north <= 90 &&
    south <= north
  if (!valid) throw new HttpError(400, 'Paramètre « bbox » invalide : attendu ouest,sud,est,nord.')
  return parts.join(',')
}

function parsePaging(query, maxPageSize) {
  return {
    page: parseNumber(query.page, 'page', { min: 1, max: 500, fallback: 1, integer: true }),
    pageSize: parseNumber(query.pageSize, 'pageSize', { min: 1, max: maxPageSize, fallback: 12, integer: true }),
    start: parseDate(query.start, 'start', { required: false }),
    end: parseDate(query.end, 'end', { required: false }),
    bbox: parseBbox(query.bbox),
  }
}

router.get('/collections', async (req, res) => {
  const result = await searchCollections({
    ...parsePaging(req.query, 50),
    keyword: parseString(req.query.keyword, 'keyword'),
    cloudHosted: req.query.cloudHosted === 'true',
  })
  res.set('Cache-Control', 'public, max-age=300')
  res.json(result)
})

router.get('/collections/:id/granules', async (req, res) => {
  if (!CONCEPT_ID.test(req.params.id)) throw new HttpError(400, 'Identifiant de collection invalide.')
  const result = await searchGranules({ ...parsePaging(req.query, 50), collectionId: req.params.id })
  res.set('Cache-Control', 'public, max-age=300')
  res.json(result)
})

export default router
