import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api } from '../api/client'
import type { GibsLayer } from '../api/client'
import { useApi } from '../hooks/useApi'
import { addDays, formatDay, todayISO } from '../lib/dates'
import { TimeControls } from './TimeControls'
import { Button, ErrorNotice, Panel, Spinner } from './ui'

interface Props {
  active: boolean
  onPickLocation: (lat: number, lon: number, date: string) => void
}

type Side = 'a' | 'b'

interface WantedLayer {
  slot: string
  key: string
  def: GibsLayer
  side: Side
  date: string
  opacity: number
  zIndex: number
}

const MAX_ZOOM = 12
const COMPARE_PANE = 'compareB'
const DEFAULT_BASE = 'MODIS_Terra_CorrectedReflectance_TrueColor'
const DEFAULT_REFERENCES = ['Coastlines_15m']
const FIRST_DATE = '2000-02-24'
const PLAY_INTERVAL_MS = 2000
// Délai après lequel l'ancienne couche est retirée même si la nouvelle n'a pas fini de charger.
const SWAP_TIMEOUT_MS = 6000
// Tuile transparente : évite l'icône d'image cassée là où GIBS n'a pas de donnée.
const BLANK_TILE = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

function createTileLayer(wanted: WantedLayer) {
  const { def } = wanted
  const options = {
    pane: wanted.side === 'b' ? COMPARE_PANE : 'tilePane',
    opacity: wanted.opacity,
    zIndex: wanted.zIndex,
    maxZoom: MAX_ZOOM,
    // Au-delà du niveau natif, Leaflet agrandit les tuiles existantes au lieu d'en demander d'inexistantes.
    maxNativeZoom: def.service === 'wmts' ? def.level : undefined,
    keepBuffer: 2,
    updateWhenZooming: false,
    errorTileUrl: BLANK_TILE,
    attribution: 'Imagerie NASA EOSDIS GIBS',
  }
  if (def.service === 'wms') {
    // Les options inconnues de Leaflet (time) sont transmises comme paramètres WMS.
    const wmsOptions = { ...options, layers: def.id, format: 'image/png', transparent: true, time: wanted.date }
    return L.tileLayer.wms(def.url, wmsOptions as L.WMSOptions)
  }
  return L.tileLayer(def.url, { ...options, time: wanted.date } as L.TileLayerOptions)
}

export function MapView({ active, onPickLocation }: Props) {
  const today = todayISO()
  const layersQuery = useApi('gibs:layers', (signal) => api.gibsLayers(signal))
  const catalog = layersQuery.data?.layers

  const [baseId, setBaseId] = useState(DEFAULT_BASE)
  const [overlays, setOverlays] = useState<Record<string, number>>({})
  const [references, setReferences] = useState<string[]>(DEFAULT_REFERENCES)
  // La mosaïque du jour même est encore incomplète : on démarre sur la veille.
  const [dateA, setDateA] = useState(() => addDays(todayISO(), -1))
  const [dateB, setDateB] = useState(() => addDays(todayISO(), -366))
  const [compare, setCompare] = useState(false)
  const [split, setSplit] = useState(0.5)
  const [playing, setPlaying] = useState(false)
  const [picked, setPicked] = useState<{ lat: number; lon: number } | null>(null)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.CircleMarker | null>(null)
  const mountedLayers = useRef(new Map<string, { slot: string; layer: L.TileLayer }>())
  const wantedKeyBySlot = useRef(new Map<string, string>())

  useEffect(() => {
    if (!containerRef.current) return
    const map = L.map(containerRef.current, {
      center: [25, 10],
      zoom: 3,
      minZoom: 2,
      maxZoom: MAX_ZOOM,
      worldCopyJump: true,
      maxBounds: [
        [-85.06, -720],
        [85.06, 720],
      ],
      maxBoundsViscosity: 1,
    })
    // Volet des couches « date B », au-dessus des tuiles « date A » et sous les marqueurs.
    map.createPane(COMPARE_PANE).style.zIndex = '250'
    map.on('click', (event) => setPicked({ lat: event.latlng.lat, lon: event.latlng.wrap().lng }))
    mapRef.current = map
    const mounted = mountedLayers.current
    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
      mounted.clear()
    }
  }, [])

  // La carte est initialisée dans un onglet éventuellement masqué : recalcul de sa taille à l'affichage.
  useEffect(() => {
    if (active) mapRef.current?.invalidateSize()
  }, [active])

  const wanted = useMemo<WantedLayer[]>(() => {
    if (!catalog) return []
    const byId = new Map(catalog.map((layer) => [layer.id, layer]))
    const list: WantedLayer[] = []
    const sides: Array<[Side, string]> = compare
      ? [
          ['a', dateA],
          ['b', dateB],
        ]
      : [['a', dateA]]

    for (const [side, date] of sides) {
      const add = (id: string, opacity: number, zIndex: number) => {
        const def = byId.get(id)
        if (!def || (def.start && date < def.start)) return
        list.push({
          slot: `${side}|${id}`,
          key: `${side}|${id}|${def.start ? date : 'static'}`,
          def,
          side,
          date,
          opacity,
          zIndex,
        })
      }
      add(baseId, 1, 1)
      Object.entries(overlays).forEach(([id, opacity], position) => add(id, opacity, 10 + position))
      references.forEach((id, position) => add(id, 1, 100 + position))
    }
    return list
  }, [catalog, baseId, overlays, references, dateA, dateB, compare])

  // Synchronisation des couches Leaflet avec la sélection. Lors d'un changement de date,
  // l'ancienne couche reste affichée jusqu'au chargement de la nouvelle (pas de flash noir).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const mounted = mountedLayers.current
    const wantedKeys = wantedKeyBySlot.current

    const prune = (slot: string) => {
      const keep = wantedKeys.get(slot)
      for (const [key, entry] of mounted) {
        if (entry.slot === slot && key !== keep) {
          map.removeLayer(entry.layer)
          mounted.delete(key)
        }
      }
    }

    wantedKeys.clear()
    for (const item of wanted) wantedKeys.set(item.slot, item.key)

    for (const [key, entry] of mounted) {
      if (!wantedKeys.has(entry.slot)) {
        map.removeLayer(entry.layer)
        mounted.delete(key)
      }
    }

    for (const item of wanted) {
      const existing = mounted.get(item.key)
      if (existing) {
        existing.layer.setOpacity(item.opacity)
        existing.layer.setZIndex(item.zIndex)
        if (!existing.layer.isLoading()) prune(item.slot)
        continue
      }
      const layer = createTileLayer(item)
      mounted.set(item.key, { slot: item.slot, layer })
      layer.once('load', () => prune(item.slot))
      setTimeout(() => prune(item.slot), SWAP_TIMEOUT_MS)
      layer.addTo(map)
    }
  }, [wanted])

  // Rideau de comparaison : le volet « date B » est rogné à droite du séparateur.
  useEffect(() => {
    const map = mapRef.current
    const pane = map?.getPane(COMPARE_PANE)
    if (!map || !pane) return
    if (!compare) {
      pane.style.clip = ''
      return
    }
    const updateClip = () => {
      const size = map.getSize()
      const topLeft = map.containerPointToLayerPoint([0, 0])
      const bottomRight = map.containerPointToLayerPoint(size)
      const divider = topLeft.x + size.x * split
      pane.style.clip = `rect(${topLeft.y}px, ${bottomRight.x}px, ${bottomRight.y}px, ${divider}px)`
    }
    updateClip()
    map.on('move zoomend resize', updateClip)
    return () => {
      map.off('move zoomend resize', updateClip)
    }
  }, [compare, split])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markerRef.current?.remove()
    markerRef.current = picked
      ? L.circleMarker([picked.lat, picked.lon], { radius: 7, color: '#38bdf8', weight: 2, fillOpacity: 0.3 }).addTo(map)
      : null
  }, [picked])

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      setDateA((current) => {
        const limit = todayISO()
        return current >= limit ? current : addDays(current, 1)
      })
    }, PLAY_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [playing])

  const dragSplit = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) return
    setSplit(Math.min(0.98, Math.max(0.02, (event.clientX - rect.left) / rect.width)))
  }

  const toggleOverlay = (id: string) =>
    setOverlays((current) => {
      if (id in current) {
        const next = { ...current }
        delete next[id]
        return next
      }
      return { ...current, [id]: 0.75 }
    })

  const toggleReference = (id: string) =>
    setReferences((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))

  const groups = useMemo(
    () => ({
      base: catalog?.filter((layer) => layer.kind === 'base') ?? [],
      overlay: catalog?.filter((layer) => layer.kind === 'overlay') ?? [],
      reference: catalog?.filter((layer) => layer.kind === 'reference') ?? [],
    }),
    [catalog],
  )

  const unavailable = (layer: GibsLayer) =>
    layer.start !== null && (dateA < layer.start || (compare && dateB < layer.start))

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div
        ref={wrapperRef}
        className="relative h-[60vh] min-h-96 overflow-hidden rounded-xl border border-slate-800 lg:h-[calc(100vh-9rem)]"
      >
        <div ref={containerRef} className="size-full bg-black" />

        {compare && (
          <>
            <div
              className="absolute inset-y-0 z-[1000] -ml-3 flex w-6 cursor-ew-resize touch-none justify-center"
              style={{ left: `${split * 100}%` }}
              onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
              onPointerMove={dragSplit}
              role="separator"
              aria-label="Séparateur de comparaison"
            >
              <div className="h-full w-0.5 bg-white shadow-[0_0_4px_rgba(0,0,0,0.8)]" />
              <div className="absolute top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white text-sm font-bold text-slate-900 shadow">
                ⇆
              </div>
            </div>
            <div className="pointer-events-none absolute bottom-6 left-3 z-[1000] rounded bg-black/70 px-2 py-1 text-xs text-white">
              A · {formatDay(dateA)}
            </div>
            <div className="pointer-events-none absolute right-3 bottom-6 z-[1000] rounded bg-black/70 px-2 py-1 text-xs text-white">
              B · {formatDay(dateB)}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-4 lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto">
        <Panel title="Date">
          <div className="flex flex-col gap-3">
            <TimeControls
              label={compare ? 'Date A (à gauche)' : undefined}
              date={dateA}
              min={FIRST_DATE}
              max={today}
              onChange={setDateA}
              playing={playing}
              onTogglePlay={() => setPlaying((value) => !value)}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-sky-400"
                checked={compare}
                onChange={(event) => setCompare(event.target.checked)}
              />
              Comparer avec une autre date
            </label>
            {compare && (
              <TimeControls label="Date B (à droite)" date={dateB} min={FIRST_DATE} max={today} onChange={setDateB} />
            )}
          </div>
        </Panel>

        {picked && (
          <Panel title="Point sélectionné">
            <p className="mb-2 text-sm tabular-nums">
              {picked.lat.toFixed(4)}°, {picked.lon.toFixed(4)}°
            </p>
            <div className="flex gap-1.5">
              <Button onClick={() => onPickLocation(picked.lat, picked.lon, dateA)}>Voir en Landsat (30 m)</Button>
              <Button onClick={() => setPicked(null)}>Effacer</Button>
            </div>
          </Panel>
        )}

        {layersQuery.error ? (
          <ErrorNotice error={layersQuery.error} onRetry={layersQuery.reload} />
        ) : !catalog ? (
          <Spinner label="Chargement des couches…" />
        ) : (
          <>
            <Panel title="Fond de carte">
              <div className="flex flex-col gap-1.5">
                {groups.base.map((layer) => (
                  <label key={layer.id} className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="base-layer"
                      className="mt-1 accent-sky-400"
                      checked={baseId === layer.id}
                      onChange={() => setBaseId(layer.id)}
                    />
                    <span>
                      {layer.title}
                      {baseId === layer.id && layer.description && (
                        <span className="block text-xs text-slate-500">{layer.description}</span>
                      )}
                      {baseId === layer.id && unavailable(layer) && (
                        <span className="block text-xs text-amber-300">
                          Disponible à partir du {formatDay(layer.start as string)}.
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </Panel>

            <Panel title="Données environnementales">
              <div className="flex flex-col gap-2">
                {groups.overlay.map((layer) => {
                  const enabled = layer.id in overlays
                  return (
                    <div key={layer.id}>
                      <label className="flex cursor-pointer items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1 accent-sky-400"
                          checked={enabled}
                          onChange={() => toggleOverlay(layer.id)}
                        />
                        <span>
                          {layer.title}
                          <span className="block text-xs text-slate-500">{layer.description}</span>
                        </span>
                      </label>
                      {enabled && (
                        <div className="mt-1 ml-6 flex items-center gap-2">
                          <input
                            type="range"
                            className="flex-1 accent-sky-400"
                            min={0.1}
                            max={1}
                            step={0.05}
                            value={overlays[layer.id]}
                            onChange={(event) =>
                              setOverlays((current) => ({ ...current, [layer.id]: Number(event.target.value) }))
                            }
                            aria-label={`Opacité : ${layer.title}`}
                          />
                          <span className="w-9 text-right text-xs text-slate-400 tabular-nums">
                            {Math.round(overlays[layer.id] * 100)} %
                          </span>
                        </div>
                      )}
                      {enabled && unavailable(layer) && (
                        <p className="ml-6 text-xs text-amber-300">
                          Disponible à partir du {formatDay(layer.start as string)}.
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </Panel>

            <Panel title="Repères">
              <div className="flex flex-col gap-1.5">
                {groups.reference.map((layer) => (
                  <label key={layer.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-sky-400"
                      checked={references.includes(layer.id)}
                      onChange={() => toggleReference(layer.id)}
                    />
                    {layer.title}
                  </label>
                ))}
              </div>
            </Panel>
          </>
        )}
      </div>
    </div>
  )
}
