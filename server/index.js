import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { config } from './config.js'
import { HttpError, getRateLimit } from './lib/http.js'
import earthRoutes from './routes/earth.js'
import earthdataRoutes from './routes/earthdata.js'
import epicRoutes from './routes/epic.js'
import gibsRoutes from './routes/gibs.js'
import * as earthImagery from './services/earthImagery.js'
import * as earthdata from './services/earthdata.js'
import * as epic from './services/epic.js'

const app = express()
app.disable('x-powered-by')

app.use('/api/epic', epicRoutes)
app.use('/api/earth', earthRoutes)
app.use('/api/gibs', gibsRoutes)
app.use('/api/earthdata', earthdataRoutes)

app.get('/api/status', (_req, res) => {
  res.json({
    apiKey: config.isDemoKey ? 'demo' : 'custom',
    rateLimit: getRateLimit(),
    cache: { epic: epic.cacheInfo(), earth: earthImagery.cacheInfo(), earthdata: earthdata.cacheInfo() },
  })
})

app.use('/api', (_req, _res, next) => {
  next(new HttpError(404, 'Route API inconnue.'))
})

// En production (après `npm run build`), le serveur sert aussi le frontend compilé.
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
if (existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir, { maxAge: '1h' }))
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next()
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.use((err, _req, res, _next) => {
  const status = err instanceof HttpError ? err.status : 500
  if (status >= 500) console.error(`[erreur ${status}]`, err.message)
  if (err.retryAfter) res.set('Retry-After', String(err.retryAfter))
  res.status(status).json({
    error: {
      status,
      message: err instanceof HttpError ? err.message : 'Erreur interne du serveur.',
      retryAfter: err.retryAfter ?? null,
    },
  })
})

app.listen(config.port, () => {
  console.log(`API Earth View : http://localhost:${config.port}`)
  console.log(
    config.isDemoKey
      ? 'Clé NASA : DEMO_KEY (quota réduit). Définissez NASA_API_KEY dans .env pour lever la limite.'
      : 'Clé NASA : NASA_API_KEY personnalisée.',
  )
  epic.warmUp().catch((err) => console.warn('Préchargement EPIC impossible :', err.message))
})
