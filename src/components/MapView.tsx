import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api } from '../api/client'
import type { GibsLayer, NaturalEvent } from '../api/client'
import { useApi } from '../hooks/useApi'
import { addDays, formatDay, todayISO } from '../lib/dates'
import { eventColor } from '../lib/events'
import type { GlobeLayer, GlobeViewState } from './GlobeView'
import { TimeControls } from './TimeControls'
import { Button, ErrorNotice, Panel, Spinner } from './ui'

// MapLibre (≈ 1 Mo) n'est téléchargé qu'à la première ouverture du globe.
const GlobeView = lazy(() => import('./GlobeView'))

interface Props {
  active: boolean
  onPickLocation: (lat: number, lon: number, date: string) => void
}

type Side = 'a' | 'b'
type Mode = '2d' | '3d'

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
const EVENT_PERIODS = [7, 30, 90]
// Délai après lequel l'ancienne couche est retirée même si la nouvelle n'a pas fini de charger.
const SWAP_TIMEOUT_MS = 6000
// Tuile transparente : évite l'icône d'image cassée là où GIBS n'a pas de donnée.
const BLANK_TILE = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='
const NO_EVENTS: NaturalEvent[] = []

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

/** URL de tuiles pour MapLibre : la date est inscrite dans l'URL, le WMS reçoit l'emprise de chaque tuile. */
function globeTileUrl(def: GibsLayer, date: string) {
  if (def.service === 'wms') {
    const params = new URLSearchParams({
      SERVICE: 'WMS',
      REQUEST: 'GetMap',
      VERSION: '1.1.1',
      LAYERS: def.id,
      STYLES: '',
      FORMAT: 'image/png',
      TRANSPARENT: 'true',
      SRS: 'EPSG:3857',
      WIDTH: '256',
      HEIGHT: '256',
      TIME: date,
    })
    return `${def.url}?${params}&BBOX={bbox-epsg-3857}`
  }
  return def.url.replace('{time}', date)
}

function formatEventDate(iso: string) {
  return `${formatDay(iso)}, ${iso.slice(11, 16)} UTC`
}

export function MapView({ active, onPickLocation }: Props) {
  const today = todayISO()
  const layersQuery = useApi('gibs:layers', (signal) => api.gibsLayers(signal))
  const catalog = layersQuery.data?.layers

  const [mode, setMode] = useState<Mode>('2d')
  const [globeView, setGlobeView] = useState<GlobeViewState>({ lat: 25, lon: 10, zoom: 2 })
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
  const [focus, setFocus] = useState<{ lat: number; lon: number; seq: number } | null>(null)

  const [eventsOn, setEventsOn] = useState(false)
  const [eventDays, setEventDays] = useState(30)
  const [hiddenCategories, setHiddenCategories] = useState<string[]>([])
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)

  const eventsQuery = useApi(eventsOn ? `eonet:${eventDays}` : null, (signal) => api.events(eventDays, signal))
  const allEvents = eventsOn ? (eventsQuery.data?.events ?? NO_EVENTS) : NO_EVENTS
  const visibleEvents = useMemo(
    () => allEvents.filter((event) => !hiddenCategories.includes(event.category)),
    [allEvents, hiddenCategories],
  )
  const selectedEvent = visibleEvents.find((event) => event.id === selectedEventId) ?? null
  const categories = useMemo(() => {
    const counts = new Map<string, { id: string; label: string; count: number }>()
    for (const event of allEvents) {
      const entry = counts.get(event.category) ?? { id: event.category, label: event.categoryLabel, count: 0 }
      entry.count++
      counts.set(event.category, entry)
    }
    return [...counts.values()].sort((a, b) => b.count - a.count)
  }, [allEvents])

  // Le rideau de comparaison n'existe que sur la carte plane.
  const comparing = compare && mode === '2d'

  const wrapperRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.CircleMarker | null>(null)
  const eventLayerRef = useRef<L.LayerGroup | null>(null)
  const mountedLayers = useRef(new Map<string, { slot: string; layer: L.TileLayer }>())
  const wantedKeyBySlot = useRef(new Map<string, string>())
  // Dernière vue du globe, reprise par la carte plane au retour en 2D.
  const lastGlobeView = useRef<GlobeViewState | null>(null)

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
    eventLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    const mounted = mountedLayers.current
    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
      eventLayerRef.current = null
      mounted.clear()
    }
  }, [])

  // La carte est masquée quand l'onglet ou le mode 2D n'est pas affiché : à son retour,
  // on recalcule sa taille et on reprend la vue laissée sur le globe.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !active || mode !== '2d') return
    map.invalidateSize()
    const view = lastGlobeView.current
    if (view) {
      lastGlobeView.current = null
      map.setView([Math.max(-85, Math.min(85, view.lat)), view.lon], Math.round(view.zoom + 1), { animate: false })
    }
  }, [active, mode])

  const wanted = useMemo<WantedLayer[]>(() => {
    if (!catalog) return []
    const byId = new Map(catalog.map((layer) => [layer.id, layer]))
    const list: WantedLayer[] = []
    const sides: Array<[Side, string]> = comparing
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
  }, [catalog, baseId, overlays, references, dateA, dateB, comparing])

  const globeLayers = useMemo<GlobeLayer[]>(
    () =>
      wanted
        .filter((item) => item.side === 'a')
        .map((item) => ({
          slot: item.slot,
          key: item.key,
          url: globeTileUrl(item.def, item.date),
          maxzoom: item.def.service === 'wmts' ? item.def.level : undefined,
          opacity: item.opacity,
        })),
    [wanted],
  )

  // Synchronisation des couches Leaflet avec la sélection. Lors d'un changement de date,
  // l'ancienne couche reste affichée jusqu'au chargement de la nouvelle (pas de flash noir).
  useEffect(() => {
    const map = mapRef.current
    // En 3D la carte plane est masquée : inutile d'y charger des tuiles.
    if (!map || mode !== '2d') return
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
  }, [wanted, mode])

  // Rideau de comparaison : le volet « date B » est rogné à droite du séparateur.
  useEffect(() => {
    const map = mapRef.current
    const pane = map?.getPane(COMPARE_PANE)
    if (!map || !pane) return
    if (!comparing) {
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
  }, [comparing, split])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markerRef.current?.remove()
    markerRef.current = picked
      ? L.circleMarker([picked.lat, picked.lon], { radius: 7, color: '#38bdf8', weight: 2, fillOpacity: 0.3 }).addTo(map)
      : null
  }, [picked])

  // Marqueurs des événements naturels sur la carte plane.
  useEffect(() => {
    const group = eventLayerRef.current
    if (!group) return
    group.clearLayers()
    for (const event of visibleEvents) {
      L.circleMarker([event.lat, event.lon], {
        radius: 6,
        color: '#ffffff',
        weight: 1.2,
        fillColor: eventColor(event.category),
        fillOpacity: 1,
        // Le clic sur un marqueur ne doit pas aussi sélectionner un point de la carte.
        bubblingMouseEvents: false,
      })
        .bindTooltip(event.title)
        .on('click', () => setSelectedEventId(event.id))
        .addTo(group)
    }
  }, [visibleEvents])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus || mode !== '2d') return
    map.setView([focus.lat, focus.lon], Math.max(map.getZoom(), 5))
  }, [focus, mode])

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

  const switchMode = (next: Mode) => {
    if (next === mode) return
    const map = mapRef.current
    if (next === '3d' && map) {
      const center = map.getCenter().wrap()
      setGlobeView({ lat: center.lat, lon: center.lng, zoom: Math.max(0.6, map.getZoom() - 1) })
      lastGlobeView.current = null
    }
    setMode(next)
  }

  const rememberGlobeView = useCallback((view: GlobeViewState) => {
    lastGlobeView.current = view
  }, [])
  const pickOnGlobe = useCallback((lat: number, lon: number) => setPicked({ lat, lon }), [])

  const focusEvent = (event: NaturalEvent) => {
    setSelectedEventId(event.id)
    setFocus((current) => ({ lat: event.lat, lon: event.lon, seq: (current?.seq ?? 0) + 1 }))
  }

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

  const toggleCategory = (id: string) =>
    setHiddenCategories((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))

  const groups = useMemo(
    () => ({
      base: catalog?.filter((layer) => layer.kind === 'base') ?? [],
      overlay: catalog?.filter((layer) => layer.kind === 'overlay') ?? [],
      reference: catalog?.filter((layer) => layer.kind === 'reference') ?? [],
    }),
    [catalog],
  )

  const unavailable = (layer: GibsLayer) =>
    layer.start !== null && (dateA < layer.start || (comparing && dateB < layer.start))

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div
        ref={wrapperRef}
        className="relative h-[60vh] min-h-96 overflow-hidden rounded-xl border border-slate-800 lg:h-[calc(100vh-9rem)]"
      >
        <div ref={containerRef} className={`size-full bg-black ${mode === '2d' ? '' : 'hidden'}`} />

        {mode === '3d' && (
          <Suspense
            fallback={
              <div className="flex size-full items-center justify-center bg-black">
                <Spinner label="Chargement du globe…" />
              </div>
            }
          >
            <GlobeView
              layers={globeLayers}
              events={visibleEvents}
              picked={picked}
              initialView={globeView}
              focus={focus}
              onViewChange={rememberGlobeView}
              onPick={pickOnGlobe}
              onSelectEvent={setSelectedEventId}
            />
          </Suspense>
        )}

        <div className="absolute top-3 right-3 z-[1000] flex overflow-hidden rounded-md border border-slate-600 bg-slate-900/90 text-sm shadow">
          {(['2d', '3d'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => switchMode(item)}
              aria-pressed={mode === item}
              className={`px-3 py-1.5 ${mode === item ? 'bg-sky-500 font-semibold text-slate-950' : 'text-slate-200 hover:bg-slate-700'}`}
            >
              {item === '2d' ? 'Carte 2D' : 'Globe 3D'}
            </button>
          ))}
        </div>

        {comparing && (
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
              label={comparing ? 'Date A (à gauche)' : undefined}
              date={dateA}
              min={FIRST_DATE}
              max={today}
              onChange={setDateA}
              playing={playing}
              onTogglePlay={() => setPlaying((value) => !value)}
            />
            {mode === '2d' ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-sky-400"
                  checked={compare}
                  onChange={(event) => setCompare(event.target.checked)}
                />
                Comparer avec une autre date
              </label>
            ) : (
              <p className="text-xs text-slate-500">La comparaison de deux dates se fait sur la carte 2D.</p>
            )}
            {comparing && (
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

        <Panel title="Événements naturels en cours">
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-sky-400"
                checked={eventsOn}
                onChange={(event) => setEventsOn(event.target.checked)}
              />
              Afficher les événements suivis par la NASA (EONET)
            </label>

            {eventsOn && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-400">Observés depuis</span>
                  {EVENT_PERIODS.map((days) => (
                    <Button
                      key={days}
                      className="!px-2 !py-1 !text-xs"
                      active={eventDays === days}
                      onClick={() => setEventDays(days)}
                    >
                      {days} j
                    </Button>
                  ))}
                </div>

                {eventsQuery.error ? (
                  <ErrorNotice error={eventsQuery.error} onRetry={eventsQuery.reload} />
                ) : eventsQuery.loading ? (
                  <Spinner label="Chargement des événements…" />
                ) : allEvents.length === 0 ? (
                  <p className="text-sm text-slate-400">Aucun événement sur cette période.</p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {categories.map((category) => {
                        const hidden = hiddenCategories.includes(category.id)
                        return (
                          <button
                            key={category.id}
                            type="button"
                            onClick={() => toggleCategory(category.id)}
                            aria-pressed={!hidden}
                            className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${
                              hidden ? 'border-slate-800 text-slate-500' : 'border-slate-600 text-slate-200'
                            }`}
                          >
                            <span
                              className="size-2.5 rounded-full"
                              style={{ backgroundColor: hidden ? 'transparent' : eventColor(category.id) }}
                            />
                            {category.label} · {category.count}
                          </button>
                        )
                      })}
                    </div>

                    {selectedEvent && (
                      <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm">
                        <p className="font-semibold text-slate-100">{selectedEvent.title}</p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {selectedEvent.categoryLabel} · dernière position le {formatEventDate(selectedEvent.date)}
                          {selectedEvent.magnitude &&
                            ` · ${selectedEvent.magnitude.value.toLocaleString('fr-FR')} ${selectedEvent.magnitude.unit}`}
                          {selectedEvent.positions > 1 && ` · suivi depuis le ${formatDay(selectedEvent.firstDate)}`}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <Button
                            className="!px-2 !py-1 !text-xs"
                            onClick={() => setDateA(selectedEvent.date.slice(0, 10))}
                          >
                            Imagerie de ce jour
                          </Button>
                          {selectedEvent.sourceUrl && (
                            <a
                              href={selectedEvent.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-sky-300 hover:underline"
                            >
                              Source
                            </a>
                          )}
                        </div>
                      </div>
                    )}

                    <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto pr-1">
                      {visibleEvents.map((event) => (
                        <li key={event.id}>
                          <button
                            type="button"
                            onClick={() => focusEvent(event)}
                            className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-slate-800 ${
                              event.id === selectedEventId ? 'bg-slate-800' : ''
                            }`}
                          >
                            <span
                              className="size-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: eventColor(event.category) }}
                            />
                            <span className="min-w-0 flex-1 truncate">{event.title}</span>
                            <span className="shrink-0 text-xs text-slate-500 tabular-nums">{event.date.slice(5, 10)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
        </Panel>

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
