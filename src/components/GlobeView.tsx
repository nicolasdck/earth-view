import { useEffect, useRef } from 'react'
import { Map as GlobeMap, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import type { GeoJSONSource, MapOptions } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre 6 charge son worker depuis un fichier séparé ; Vite le compile et en fournit l'URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { NaturalEvent } from '../api/client'
import { eventColor } from '../lib/events'

setWorkerUrl(workerUrl)

export interface GlobeLayer {
  /** Emplacement logique (une couche GIBS) : sert à remplacer en douceur une date par une autre. */
  slot: string
  key: string
  url: string
  maxzoom?: number
  opacity: number
}

export interface GlobeViewState {
  lat: number
  lon: number
  /** Niveau de zoom au sens de MapLibre (tuiles de 512 px) : zoom Leaflet − 1. */
  zoom: number
}

interface Props {
  layers: GlobeLayer[]
  events: NaturalEvent[]
  picked: { lat: number; lon: number } | null
  initialView: GlobeViewState
  focus: { lat: number; lon: number; seq: number } | null
  onViewChange: (view: GlobeViewState) => void
  onPick: (lat: number, lon: number) => void
  onSelectEvent: (id: string) => void
}

const EVENTS = 'events'
const PICKED = 'picked'
const SWAP_TIMEOUT_MS = 6000

const STYLE: MapOptions['style'] = {
  version: 8,
  projection: { type: 'globe' },
  // Halo atmosphérique, estompé quand on s'approche du sol.
  sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 1, 7, 0] },
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#000000' } }],
}

const emptyCollection = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] })

const pointFeature = (lon: number, lat: number, properties: Record<string, string> = {}): GeoJSON.Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties,
})

const layerId = (key: string) => `gibs:${key}`

export default function GlobeView({
  layers,
  events,
  picked,
  initialView,
  focus,
  onViewChange,
  onPick,
  onSelectEvent,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<GlobeMap | null>(null)
  const loadedRef = useRef(false)
  const mounted = useRef(new Map<string, string>())

  // Dernières valeurs des props, lues par les gestionnaires posés une seule fois sur la carte.
  const latest = useRef({ layers, events, picked, onViewChange, onPick, onSelectEvent })
  useEffect(() => {
    latest.current = { layers, events, picked, onViewChange, onPick, onSelectEvent }
  })

  const syncRef = useRef({ layers: () => {}, events: () => {}, picked: () => {} })

  useEffect(() => {
    if (!containerRef.current) return
    const map = new GlobeMap({
      container: containerRef.current,
      style: STYLE,
      center: [initialView.lon, initialView.lat],
      zoom: initialView.zoom,
      minZoom: 0.6,
      maxZoom: 11,
      attributionControl: { compact: true },
    })
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-left')
    mapRef.current = map
    const mountedLayers = mounted.current

    const removeLayer = (key: string) => {
      const id = layerId(key)
      if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(id)) map.removeSource(id)
      mountedLayers.delete(key)
    }

    const prune = () => {
      const wanted = new Set(latest.current.layers.map((layer) => layer.key))
      for (const key of [...mountedLayers.keys()]) {
        if (!wanted.has(key)) removeLayer(key)
      }
    }

    // Lors d'un changement de date, l'ancienne couche reste sous la nouvelle jusqu'à ce que
    // la carte ait fini de charger (événement « idle »), pour éviter un passage au noir.
    const syncLayers = () => {
      const wanted = latest.current.layers
      const wantedKeys = new Set(wanted.map((layer) => layer.key))
      const wantedSlots = new Set(wanted.map((layer) => layer.slot))

      let swapping = false
      for (const [key, slot] of [...mountedLayers]) {
        if (wantedKeys.has(key)) continue
        if (wantedSlots.has(slot)) swapping = true
        else removeLayer(key)
      }

      for (const layer of wanted) {
        const id = layerId(layer.key)
        if (mountedLayers.has(layer.key)) {
          map.setPaintProperty(id, 'raster-opacity', layer.opacity)
        } else {
          map.addSource(id, {
            type: 'raster',
            tiles: [layer.url],
            tileSize: 256,
            ...(layer.maxzoom === undefined ? {} : { maxzoom: layer.maxzoom }),
            attribution: 'Imagerie NASA EOSDIS GIBS',
          })
          map.addLayer(
            { id, type: 'raster', source: id, paint: { 'raster-opacity': layer.opacity, 'raster-fade-duration': 200 } },
            EVENTS,
          )
          mountedLayers.set(layer.key, layer.slot)
        }
        // Replacée juste sous les marqueurs : à la fin de la boucle, l'ordre est celui de `wanted`.
        map.moveLayer(id, EVENTS)
      }

      if (swapping) {
        map.once('idle', prune)
        setTimeout(() => {
          if (mapRef.current === map) prune()
        }, SWAP_TIMEOUT_MS)
      }
    }

    const syncEvents = () => {
      const features = latest.current.events.map((event) =>
        pointFeature(event.lon, event.lat, { id: event.id, title: event.title, color: eventColor(event.category) }),
      )
      map.getSource<GeoJSONSource>(EVENTS)?.setData({ type: 'FeatureCollection', features })
    }

    const syncPicked = () => {
      const point = latest.current.picked
      map
        .getSource<GeoJSONSource>(PICKED)
        ?.setData(point ? { type: 'FeatureCollection', features: [pointFeature(point.lon, point.lat)] } : emptyCollection())
    }

    syncRef.current = { layers: syncLayers, events: syncEvents, picked: syncPicked }

    map.on('load', () => {
      map.addSource(EVENTS, { type: 'geojson', data: emptyCollection() })
      map.addLayer({
        id: EVENTS,
        type: 'circle',
        source: EVENTS,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 4, 6, 8],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.2,
        },
      })
      map.addSource(PICKED, { type: 'geojson', data: emptyCollection() })
      map.addLayer({
        id: PICKED,
        type: 'circle',
        source: PICKED,
        paint: {
          'circle-radius': 7,
          'circle-color': 'rgba(56, 189, 248, 0.3)',
          'circle-stroke-color': '#38bdf8',
          'circle-stroke-width': 2,
        },
      })
      loadedRef.current = true
      syncLayers()
      syncEvents()
      syncPicked()
    })

    map.on('click', (event) => {
      const hit = loadedRef.current ? map.queryRenderedFeatures(event.point, { layers: [EVENTS] })[0] : undefined
      if (hit) {
        latest.current.onSelectEvent(String(hit.properties.id))
        return
      }
      const position = event.lngLat.wrap()
      latest.current.onPick(position.lat, position.lng)
    })
    map.on('mouseenter', EVENTS, () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', EVENTS, () => {
      map.getCanvas().style.cursor = ''
    })
    map.on('moveend', () => {
      const center = map.getCenter().wrap()
      latest.current.onViewChange({ lat: center.lat, lon: center.lng, zoom: map.getZoom() })
    })

    return () => {
      loadedRef.current = false
      mapRef.current = null
      mountedLayers.clear()
      map.remove()
    }
    // La vue initiale n'est lue qu'à la création du globe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    latest.current.layers = layers
    if (loadedRef.current) syncRef.current.layers()
  }, [layers])

  useEffect(() => {
    latest.current.events = events
    if (loadedRef.current) syncRef.current.events()
  }, [events])

  useEffect(() => {
    latest.current.picked = picked
    if (loadedRef.current) syncRef.current.picked()
  }, [picked])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus) return
    map.flyTo({ center: [focus.lon, focus.lat], zoom: Math.max(map.getZoom(), 3.5), duration: 1500 })
  }, [focus])

  return <div ref={containerRef} className="size-full bg-black" />
}
