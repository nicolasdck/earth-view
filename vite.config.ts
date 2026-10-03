import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        // 'prompt' : la nouvelle version attend que l'utilisateur accepte la mise à jour (bannière).
        registerType: 'prompt',
        // L'enregistrement est fait par useRegisterSW dans PwaBanners.tsx.
        injectRegister: false,
        // Le manifest est un fichier statique : public/manifest.webmanifest.
        manifest: false,
        workbox: {
          globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
          // Hors du précache : les icônes que seul le système utilise à l'installation
          // (l'interface n'affiche que icon-192 et les favicons).
          // Le globe 3D (MapLibre, ≈ 1,5 Mo) n'est téléchargé qu'à sa première ouverture.
          globIgnores: [
            'icons/*-512.png',
            'icons/maskable-*.png',
            'icons/apple-touch-icon.png',
            'assets/GlobeView-*',
            'assets/maplibre-gl-worker-*',
          ],
          navigateFallback: 'index.html',
          // Les appels à l'API ne doivent jamais recevoir index.html en réponse.
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    // MapLibre lance son worker en tant que module ES (new Worker(url, { type: 'module' })).
    worker: { format: 'es' as const },
    // Le fragment du globe (MapLibre) dépasse le seuil par défaut ; il est chargé à la demande.
    build: { chunkSizeWarningLimit: 1100 },
    server: {
      proxy: {
        '/api': `http://localhost:${env.PORT || 3001}`,
      },
    },
  }
})
