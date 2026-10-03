import process from 'node:process'

// Charge .env s'il existe (Node >= 20.12) ; l'absence du fichier n'est pas une erreur.
try {
  process.loadEnvFile()
} catch {
  // pas de .env : on s'appuie sur l'environnement du processus
}

const nasaApiKey = process.env.NASA_API_KEY?.trim() || 'DEMO_KEY'

export const config = {
  port: Number(process.env.PORT) || 3001,
  nasaApiKey,
  isDemoKey: nasaApiKey === 'DEMO_KEY',
}
