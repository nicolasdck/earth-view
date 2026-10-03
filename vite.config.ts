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
          globIgnores: ['icons/*-512.png', 'icons/maskable-*.png', 'icons/apple-touch-icon.png'],
          navigateFallback: 'index.html',
          // Les appels à l'API ne doivent jamais recevoir index.html en réponse.
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    server: {
      proxy: {
        '/api': `http://localhost:${env.PORT || 3001}`,
      },
    },
  }
})
