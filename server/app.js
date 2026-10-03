import express from 'express'
import { config } from './config.js'
import { HttpError, getRateLimit } from './lib/http.js'
import earthRoutes from './routes/earth.js'
import earthdataRoutes from './routes/earthdata.js'
import eonetRoutes from './routes/eonet.js'
import epicRoutes from './routes/epic.js'
import gibsRoutes from './routes/gibs.js'
import imagesRoutes from './routes/images.js'
import * as earthImagery from './services/earthImagery.js'
import * as earthdata from './services/earthdata.js'
import * as epic from './services/epic.js'

// Application Express de l'API, sans écoute réseau : elle est démarrée par server/index.js
// en local et exportée telle quelle comme fonction serverless par api/index.js sur Vercel.
const app = express()
app.disable('x-powered-by')

app.use('/api/epic', epicRoutes)
app.use('/api/earth', earthRoutes)
app.use('/api/gibs', gibsRoutes)
app.use('/api/earthdata', earthdataRoutes)
app.use('/api/eonet', eonetRoutes)
app.use('/api/images', imagesRoutes)

app.get('/api/status', (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({
    apiKey: config.isDemoKey ? 'demo' : 'custom',
    rateLimit: getRateLimit(),
    cache: { epic: epic.cacheInfo(), earth: earthImagery.cacheInfo(), earthdata: earthdata.cacheInfo() },
  })
})

app.use('/api', (_req, _res, next) => {
  next(new HttpError(404, 'Route API inconnue.'))
})

app.use((err, _req, res, _next) => {
  const status = err instanceof HttpError ? err.status : 500
  if (status >= 500) console.error(`[erreur ${status}]`, err.message)
  if (err.retryAfter) res.set('Retry-After', String(err.retryAfter))
  // Une erreur ne doit pas être conservée par le CDN ni par le navigateur.
  res.set('Cache-Control', 'no-store')
  res.status(status).json({
    error: {
      status,
      message: err instanceof HttpError ? err.message : 'Erreur interne du serveur.',
      retryAfter: err.retryAfter ?? null,
    },
  })
})

export default app
