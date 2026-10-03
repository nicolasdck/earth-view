// Génère les icônes de l'application à partir d'une image carrée (PNG transparent conseillé) :
//   npm run icons -- chemin/vers/logo.png
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'public/icons')

const source = process.argv[2] && path.resolve(process.argv[2])
if (!source || !existsSync(source)) {
  console.error('Image source introuvable. Usage : npm run icons -- chemin/vers/logo.png')
  process.exit(1)
}

// Même couleur que background_color / theme_color du manifest.
const BACKGROUND = '#020617'
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

/**
 * `scale` = part de l'icône occupée par le logo. Les icônes « maskable » peuvent être
 * rognées en cercle par le système : le logo doit tenir dans les 80 % centraux.
 */
const ICONS = [
  { file: 'favicon-32.png', size: 32, scale: 1, background: TRANSPARENT },
  { file: 'favicon-48.png', size: 48, scale: 1, background: TRANSPARENT },
  { file: 'icon-192.png', size: 192, scale: 1, background: TRANSPARENT },
  { file: 'icon-512.png', size: 512, scale: 1, background: TRANSPARENT },
  { file: 'maskable-192.png', size: 192, scale: 0.74, background: BACKGROUND },
  { file: 'maskable-512.png', size: 512, scale: 0.74, background: BACKGROUND },
  // iOS n'accepte pas la transparence (elle devient noire) et arrondit lui-même les coins.
  { file: 'apple-touch-icon.png', size: 180, scale: 0.86, background: BACKGROUND },
]

await mkdir(outDir, { recursive: true })

for (const icon of ICONS) {
  const inner = Math.round(icon.size * icon.scale)
  const logo = await sharp(source)
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
    .toBuffer()

  await sharp({ create: { width: icon.size, height: icon.size, channels: 4, background: icon.background } })
    .composite([{ input: logo, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(outDir, icon.file))

  console.log(`public/icons/${icon.file} (${icon.size}×${icon.size})`)
}
