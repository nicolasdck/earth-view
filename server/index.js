import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import app from './app.js'
import { config } from './config.js'
import * as epic from './services/epic.js'

// Serveur autonome (développement local ou hébergement Node classique).
// Après `npm run build`, il sert aussi le frontend compilé.
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
if (existsSync(path.join(distDir, 'index.html'))) {
  // Les fichiers de /assets ont un nom haché (cache long) ; le reste, dont index.html, sw.js
  // et le manifest, doit être revalidé pour que les mises à jour de la PWA soient détectées.
  app.use(
    express.static(distDir, {
      setHeaders(res, filePath) {
        const hashed = filePath.includes(`${path.sep}assets${path.sep}`)
        res.set('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache')
      },
    }),
  )
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next()
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.listen(config.port, () => {
  console.log(`API Earth View : http://localhost:${config.port}`)
  console.log(
    config.isDemoKey
      ? 'Clé NASA : DEMO_KEY (quota réduit). Définissez NASA_API_KEY dans .env pour lever la limite.'
      : 'Clé NASA : NASA_API_KEY personnalisée.',
  )
  epic.warmUp().catch((err) => console.warn('Préchargement EPIC impossible :', err.message))
})
