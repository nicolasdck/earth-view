import { useState } from 'react'
import { api } from './api/client'
import { EarthdataSearch } from './components/EarthdataSearch'
import { EpicView } from './components/EpicView'
import { LandsatView } from './components/LandsatView'
import type { LandsatRequest } from './components/LandsatView'
import { MapView } from './components/MapView'
import { useApi } from './hooks/useApi'

type TabId = 'epic' | 'map' | 'landsat' | 'search'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'epic', label: 'Vue globale' },
  { id: 'map', label: 'Carte & couches' },
  { id: 'landsat', label: 'Landsat' },
  { id: 'search', label: 'Jeux de données' },
]

function StatusBadge({ tab }: { tab: TabId }) {
  // Rechargé à chaque changement d'onglet pour refléter le quota restant.
  const status = useApi(`status:${tab}`, (signal) => api.status(signal))
  const data = status.data ?? status.stale
  if (!data) return null

  const { remaining, limit, blockedForSeconds } = data.rateLimit
  const blocked = blockedForSeconds > 0
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-xs ${
        blocked
          ? 'border-rose-500/50 text-rose-200'
          : data.apiKey === 'demo'
            ? 'border-amber-500/50 text-amber-200'
            : 'border-emerald-500/50 text-emerald-200'
      }`}
      title={
        data.apiKey === 'demo'
          ? 'Définissez NASA_API_KEY dans le fichier .env pour augmenter le quota.'
          : 'Clé NASA_API_KEY chargée depuis l’environnement.'
      }
    >
      {data.apiKey === 'demo' ? 'DEMO_KEY' : 'Clé NASA personnelle'}
      {blocked
        ? ` · quota atteint (${blockedForSeconds} s)`
        : remaining !== null && ` · ${remaining}${limit !== null ? ` / ${limit}` : ''} requêtes restantes`}
    </span>
  )
}

function App() {
  const [tab, setTab] = useState<TabId>('epic')
  // Un onglet n'est monté qu'à sa première visite, puis reste monté pour conserver son état.
  const [visited, setVisited] = useState<TabId[]>(['epic'])
  const [landsatRequest, setLandsatRequest] = useState<(LandsatRequest & { id: number }) | null>(null)

  const openTab = (next: TabId) => {
    setTab(next)
    setVisited((current) => (current.includes(next) ? current : [...current, next]))
  }

  const showInLandsat = (lat: number, lon: number, date: string) => {
    setLandsatRequest((current) => ({ lat, lon, date, id: (current?.id ?? 0) + 1 }))
    openTab('landsat')
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-[1100] border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-[110rem] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
          <h1 className="text-base font-semibold tracking-tight">
            Earth View <span className="font-normal text-slate-500">· imagerie NASA</span>
          </h1>
          <nav className="flex flex-wrap gap-1">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openTab(item.id)}
                aria-current={tab === item.id ? 'page' : undefined}
                className={`rounded-md px-3 py-1.5 text-sm transition ${
                  tab === item.id ? 'bg-sky-500/20 text-sky-100' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="ml-auto">
            <StatusBadge tab={tab} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[110rem] p-4">
        <div hidden={tab !== 'epic'}>{visited.includes('epic') && <EpicView />}</div>
        <div hidden={tab !== 'map'}>
          {visited.includes('map') && <MapView active={tab === 'map'} onPickLocation={showInLandsat} />}
        </div>
        <div hidden={tab !== 'landsat'}>
          {visited.includes('landsat') && <LandsatView key={landsatRequest?.id ?? 0} request={landsatRequest} />}
        </div>
        <div hidden={tab !== 'search'}>{visited.includes('search') && <EarthdataSearch />}</div>
      </main>
    </div>
  )
}

export default App
