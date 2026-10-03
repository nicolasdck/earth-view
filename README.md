# Earth View

Application web d'exploration de l'imagerie de la Terre à partir des APIs de la NASA : vue globale quotidienne,
carte interactive avec couches environnementales, imagerie Landsat à 30 m et recherche dans le catalogue Earthdata,
avec comparaison entre deux dates.

## Fonctionnalités

| Onglet | Source | Ce qu'on y fait |
| --- | --- | --- |
| **Vue globale** | EPIC (satellite DSCOVR) | Face éclairée de la Terre jour par jour. Deux défilements : *rotation du jour* (toutes les prises de vue d'une journée) et *jour après jour* (une image par jour sur 7, 14 ou 30 jours, même face de la Terre). |
| **Carte & globe** | GIBS (WMTS / WMS) via Leaflet et MapLibre, EONET | Fonds quotidiens MODIS / VIIRS / Landsat, couches superposables (feux actifs, température de surface, nuages, précipitations, aérosols, neige, CO…), défilement des jours, **comparaison de deux dates avec un rideau glissant** (2D). Bascule **Carte 2D / Globe 3D** avec les mêmes couches et la même date. **Événements naturels en cours** (feux, cyclones, volcans, icebergs) en marqueurs, filtrables par catégorie. Un clic sur la carte envoie le point vers l'onglet Landsat. |
| **Landsat** | Earth Imagery API, repli GIBS HLS | Recherche par latitude / longitude / date, choix du passage du satellite, comparaison côte à côte de deux dates. |
| **Galerie** | NASA Image and Video Library | Photographies de la Terre depuis l'espace (ISS, Apollo, navette) : recherche par mots-clés, thèmes, époque, visionneuse plein écran. |
| **Jeux de données** | Earthdata CMR | Recherche par mots-clés, période et hébergement cloud ; aperçu des fichiers récents de chaque jeu de données. |

## Installation

Prérequis : Node.js 20.12 ou plus récent (développé avec Node 22).

```bash
npm install
cp .env.example .env    # PowerShell : Copy-Item .env.example .env
```

Renseignez ensuite `NASA_API_KEY` dans `.env` (clé gratuite sur <https://api.nasa.gov/#signUp>).
Sans clé, l'application bascule sur `DEMO_KEY` (30 requêtes par heure et par adresse IP).

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `NASA_API_KEY` | `DEMO_KEY` | Clé api.nasa.gov, utilisée uniquement côté serveur (jamais envoyée au navigateur). |
| `PORT` | `3001` | Port du serveur API. |

## Exécution

```bash
npm run dev      # API (http://localhost:3001) + frontend Vite (http://localhost:5173)
```

En production, le serveur Express sert aussi le frontend compilé :

```bash
npm run build
npm start        # http://localhost:3001
```

Autres scripts : `npm run dev:server`, `npm run dev:client`, `npm run lint`.

## Déploiement sur Vercel

Le dépôt est prêt pour Vercel ([vercel.json](vercel.json)) : le frontend est servi en statique depuis `dist/` et toutes les
routes `/api/*` sont réécrites vers une seule fonction serverless, [api/index.js](api/index.js), qui exporte l'application
Express de [server/app.js](server/app.js).

1. Importez le projet dans Vercel (ou `vercel` en ligne de commande) ; aucun réglage de build à modifier.
2. Dans *Settings → Environment Variables*, ajoutez `NASA_API_KEY` (le fichier `.env` n'est pas déployé), puis redéployez.

Différences avec le serveur local :

- Le cache mémoire ne vit que le temps d'une instance de fonction. Les réponses de l'API portent donc `s-maxage` et
  `stale-while-revalidate` pour être mises en cache par le CDN de Vercel.
- Le quota affiché dans l'en-tête et la mise à l'écart de l'API Earth Imagery sont propres à chaque instance.
- La durée maximale d'une requête est fixée à 60 s dans `vercel.json`.

## Architecture

```
api/index.js               Point d'entrée Vercel (exporte l'application Express)
server/                    Backend Node.js (Express, JavaScript ESM)
  app.js                   Application Express : routes, gestion d'erreurs
  index.js                 Serveur autonome : écoute réseau et service du build
  config.js                Lecture de .env, clé NASA (repli DEMO_KEY)
  lib/
    http.js                fetch amont : délai maximal, nouvelles tentatives, rate limiting
    cache.js               Cache mémoire TTL + LRU, déduplication, repli sur valeur périmée
    validate.js            Validation des paramètres de requête
  services/
    epic.js                EPIC : dates disponibles, images d'un jour, série quotidienne
    earthImagery.js        Earth Imagery (Landsat 8) + repli HLS via CMR et GIBS
    gibs.js                Catalogue des couches GIBS et gabarits d'URL de tuiles
    earthdata.js           Recherche CMR : collections et granules
    eonet.js               Événements naturels en cours (EONET)
    imageLibrary.js        Photothèque NASA : recherche et fichiers d'une image
  routes/                  Une route Express par API (epic, earth, gibs, earthdata, eonet, images)
src/                       Frontend React 19 + TypeScript + Tailwind
  api/client.ts            Client typé de l'API du backend
  hooks/                   useApi (chargement annulable), useDebounced
  components/
    EpicView.tsx           Vue globale et timelapse
    MapView.tsx            Carte Leaflet, couches GIBS, rideau de comparaison, événements
    GlobeView.tsx          Globe 3D MapLibre (chargé à la demande)
    GalleryView.tsx        Galerie de la photothèque NASA
    TimeControls.tsx       Contrôles temporels (jour, mois, lecture)
    LandsatView.tsx        Imagerie locale par coordonnées
    EarthdataSearch.tsx    Recherche de jeux de données
```

### Routes de l'API

| Route | Description |
| --- | --- |
| `GET /api/epic/:collection/dates` | Dates disponibles (`natural` ou `enhanced`). |
| `GET /api/epic/:collection/latest` | Images de la dernière journée disponible. |
| `GET /api/epic/:collection/date/:date` | Images d'une journée. |
| `GET /api/epic/:collection/series?end=&days=&lon=` | Une image par jour, la plus proche de la longitude donnée. |
| `GET /api/earth/assets?lat=&lon=&date=&dim=` | Acquisition Landsat retenue, passages voisins, URL de l'image. |
| `GET /api/earth/imagery?lat=&lon=&date=&dim=&source=` | Image (binaire) centrée sur le point. |
| `GET /api/gibs/layers` | Catalogue des couches cartographiques. |
| `GET /api/earthdata/collections?keyword=&page=&start=&end=&bbox=&cloudHosted=` | Recherche de jeux de données. |
| `GET /api/earthdata/collections/:id/granules` | Fichiers les plus récents d'un jeu de données. |
| `GET /api/eonet/events?days=` | Événements naturels en cours, observés dans les `days` derniers jours. |
| `GET /api/images/search?q=&page=&pageSize=&yearStart=&yearEnd=` | Recherche dans la photothèque NASA. |
| `GET /api/images/:id/files` | URL d'affichage et fichier original d'une image. |
| `GET /api/status` | Type de clé utilisée, quota restant, statistiques de cache. |

Les erreurs sont renvoyées sous la forme `{ "error": { "status", "message", "retryAfter" } }`.

## Choix techniques

**Clé API et quota.** La clé reste sur le serveur. Les en-têtes `X-RateLimit-*` d'api.nasa.gov sont suivis et affichés
dans l'en-tête de l'application. Après un `429`, le serveur cesse d'appeler api.nasa.gov pendant la durée indiquée par
`Retry-After` (5 minutes à défaut) et sert ce qu'il a en cache.

**Cache.** Toutes les réponses amont passent par un cache mémoire : durée de vie adaptée à la donnée (7 jours pour une
journée EPIC ancienne, 30 minutes pour une journée récente, 10 minutes pour une recherche), une seule requête amont
pour des demandes simultanées identiques, et valeur périmée servie si l'amont échoue. Le cache est vidé au redémarrage.

**EPIC.** Les métadonnées existent sur deux points d'accès identiques : api.nasa.gov (avec clé) et le miroir
epic.gsfc.nasa.gov (sans clé). Avec une clé personnelle, api.nasa.gov est interrogé en premier ; avec `DEMO_KEY`,
le miroir passe en premier pour ne pas épuiser le quota. Chacun sert de repli à l'autre. Les images sont chargées
directement depuis l'archive publique. Le frontend précharge les images de la séquence et les métadonnées des jours voisins.

**Landsat.** L'API Earth Imagery (`/planetary/earth`) est souvent indisponible. Le serveur l'essaie d'abord ; en cas
d'échec il la met de côté 10 minutes et bascule sur le produit HLS Landsat 8/9 (30 m) : le catalogue CMR donne les
passages du satellite au-dessus du point à ±45 jours avec leur couverture nuageuse, et l'image est rendue par le WMS
de GIBS. Le passage retenu est le plus proche de la date demandée parmi ceux ayant au plus 30 % de nuages, sinon le
plus proche tout court. HLS ne couvre que les terres émergées, à partir d'avril 2013.

**Carte.** Les tuiles sont chargées directement depuis le CDN de GIBS (CORS ouvert, cache de 3 jours), sans transiter
par le backend. Au-delà du niveau de zoom natif d'une couche, Leaflet agrandit les tuiles existantes plutôt que d'en
demander. Lors d'un changement de date, l'ancienne couche reste affichée jusqu'au chargement de la nouvelle. Les feux
actifs, publiés en tuiles vectorielles, sont demandés en WMS pour être rendus en image par GIBS.

## Application installable (PWA)

- **Icônes** : dans `public/icons/`. Pour les régénérer à partir d'un nouveau logo carré : `npm run icons -- chemin/vers/logo.png`.
- **Manifest** : `public/manifest.webmanifest`.
- **Service worker** : généré au build par `vite-plugin-pwa` ; il met en cache l'interface (pas les appels `/api` ni les tuiles).
  Il n'est pas actif avec `npm run dev` : pour le tester, `npm run build` puis `npm start`.
- **Bannière d'installation** : proposée quand le navigateur autorise l'installation (Chrome, Edge, Android) ; sur Safari iOS,
  elle indique le passage par le menu Partager. Un refus la masque pendant 14 jours.
- **Bannière de mise à jour** : affichée quand une nouvelle version est déployée (vérification au chargement puis toutes les heures) ;
  « Mettre à jour » active la nouvelle version et recharge la page.

**Globe 3D.** MapLibre GL (projection globe) affiche les tuiles GIBS de la carte, sans conversion. La bibliothèque et son
worker (≈ 1,5 Mo) forment un fragment séparé, téléchargé à la première ouverture du globe et exclu du précache de la PWA.
Le worker est compilé par Vite (`?worker&url`, format ES) et déclaré à MapLibre avec `setWorkerUrl`.

## Limites connues

- Les mosaïques du jour même sont incomplètes (les satellites n'ont pas fini leurs orbites) : la carte démarre sur la veille.
- EPIC ne publie pas d'images certains jours ; le sélecteur de date se cale sur la journée disponible précédente.
- Le téléchargement des fichiers de données Earthdata nécessite un compte Earthdata Login ; l'application n'affiche que les aperçus publics.
