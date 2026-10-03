import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { EpicCollection, EpicImage } from '../api/client'
import { useApi } from '../hooks/useApi'
import { ISO_DATE, formatDay, formatTimeUTC } from '../lib/dates'
import { Button, ErrorNotice, Panel, Spinner, inputClass } from './ui'

type Mode = 'day' | 'series'

const SPEEDS = [2, 5, 10]
const SERIES_LENGTHS = [7, 14, 30]
const NO_FRAMES: EpicImage[] = []

const formatCoord = (value: number | null, positive: string, negative: string) =>
  value === null ? '—' : `${Math.abs(value).toFixed(1)}° ${value >= 0 ? positive : negative}`

export function EpicView() {
  const [collection, setCollection] = useState<EpicCollection>('natural')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('day')
  const [seriesDays, setSeriesDays] = useState(14)
  const [anchorLon, setAnchorLon] = useState(0)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [fps, setFps] = useState(5)

  const datesQuery = useApi(`epic:dates:${collection}`, (signal) => api.epicDates(collection, signal))
  const dates = datesQuery.data?.dates

  // Date affichée : celle choisie si elle existe dans la collection, sinon la plus récente.
  const date = useMemo(() => {
    if (!dates || dates.length === 0) return null
    return selectedDate && dates.includes(selectedDate) ? selectedDate : dates[0]
  }, [dates, selectedDate])
  const dateIndex = date && dates ? dates.indexOf(date) : -1

  const dayQuery = useApi(date ? `epic:day:${collection}:${date}` : null, (signal) =>
    api.epicDay(collection, date as string, signal),
  )
  const seriesQuery = useApi(
    mode === 'series' && date ? `epic:series:${collection}:${date}:${seriesDays}:${anchorLon}` : null,
    (signal) => api.epicSeries(collection, date as string, seriesDays, anchorLon, signal),
  )

  const activeQuery = mode === 'day' ? dayQuery : seriesQuery
  const frames = activeQuery.data?.images ?? NO_FRAMES
  const frameIndex = frames.length > 0 ? Math.min(index, frames.length - 1) : 0
  const frame = frames[frameIndex] as EpicImage | undefined

  // Préchargement des images de la séquence : la lecture ne saccade pas et le
  // passage d'une vue à l'autre est instantané.
  const [preload, setPreload] = useState({ frames: NO_FRAMES, count: 0 })
  useEffect(() => {
    const images = frames.map((item) => {
      const image = new Image()
      image.onload = image.onerror = () =>
        setPreload((previous) => ({ frames, count: previous.frames === frames ? previous.count + 1 : 1 }))
      image.src = item.urls.jpg
      return image
    })
    return () => {
      for (const image of images) image.onload = image.onerror = null
    }
  }, [frames])
  const preloaded = preload.frames === frames ? Math.min(preload.count, frames.length) : 0

  // Préchargement des métadonnées des jours voisins (mises en cache par le navigateur et le serveur).
  useEffect(() => {
    if (!dates || dateIndex < 0) return
    const controller = new AbortController()
    for (const neighbour of [dates[dateIndex + 1], dates[dateIndex - 1]]) {
      if (neighbour) api.epicDay(collection, neighbour, controller.signal).catch(() => {})
    }
    return () => controller.abort()
  }, [collection, dates, dateIndex])

  useEffect(() => {
    if (!playing || frames.length < 2) return
    const timer = setInterval(() => setIndex((current) => (current + 1) % frames.length), 1000 / fps)
    return () => clearInterval(timer)
  }, [playing, fps, frames.length])

  const goToDate = (next: string | undefined) => {
    if (!next) return
    setSelectedDate(next)
    setIndex(mode === 'series' ? Number.MAX_SAFE_INTEGER : 0)
  }

  const pickDate = (value: string) => {
    if (!dates || !ISO_DATE.test(value)) return
    // Toutes les dates n'ont pas d'images : on prend la plus proche antérieure ou égale.
    goToDate(dates.find((available) => available <= value) ?? dates[dates.length - 1])
  }

  const switchMode = (next: Mode) => {
    if (next === mode) return
    setPlaying(false)
    if (next === 'series') {
      setAnchorLon(Math.round(frame?.centroid.lon ?? 0))
      // La série se termine sur la date choisie : on se place sur sa dernière image.
      setIndex(Number.MAX_SAFE_INTEGER)
    } else {
      setIndex(0)
    }
    setMode(next)
  }

  const step = (delta: number) => {
    if (frames.length === 0) return
    setPlaying(false)
    setIndex((frameIndex + delta + frames.length) % frames.length)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Panel className="flex flex-col items-center gap-3">
        <div className="relative flex aspect-square w-full max-w-[min(100%,calc(100vh-17rem))] items-center justify-center overflow-hidden rounded-lg bg-black">
          {frame ? (
            <img
              src={frame.urls.jpg}
              alt={`Terre vue par DSCOVR/EPIC le ${formatDay(frame.date)} à ${formatTimeUTC(frame.date)}`}
              className="size-full object-contain"
            />
          ) : activeQuery.loading || datesQuery.loading ? (
            <Spinner label="Chargement des images EPIC…" />
          ) : (
            <p className="px-6 text-center text-sm text-slate-400">Aucune image disponible pour cette sélection.</p>
          )}
          {frame && (
            <div className="absolute top-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-slate-100">
              {formatDay(frame.date)} · {formatTimeUTC(frame.date)}
            </div>
          )}
          {frame && activeQuery.loading && (
            <div className="absolute top-2 right-2 rounded bg-black/60 px-2 py-1">
              <Spinner />
            </div>
          )}
        </div>

        <div className="flex w-full flex-wrap items-center justify-center gap-2">
          <Button onClick={() => step(-1)} disabled={frames.length < 2} title="Image précédente">
            ◀
          </Button>
          <Button onClick={() => setPlaying((value) => !value)} active={playing} disabled={frames.length < 2}>
            {playing ? '⏸ Pause' : '▶ Lecture'}
          </Button>
          <Button onClick={() => step(1)} disabled={frames.length < 2} title="Image suivante">
            ▶
          </Button>
          <input
            type="range"
            className="min-w-40 flex-1 accent-sky-400"
            min={0}
            max={Math.max(0, frames.length - 1)}
            value={frameIndex}
            disabled={frames.length < 2}
            onChange={(event) => {
              setPlaying(false)
              setIndex(Number(event.target.value))
            }}
            aria-label="Position dans la séquence"
          />
          <span className="w-16 text-right text-xs text-slate-400 tabular-nums">
            {frames.length > 0 ? `${frameIndex + 1} / ${frames.length}` : '—'}
          </span>
        </div>

        {mode === 'day' && frames.length > 1 && (
          <div className="flex w-full gap-1.5 overflow-x-auto pb-1">
            {frames.map((item, position) => (
              <button
                key={item.identifier}
                type="button"
                onClick={() => {
                  setPlaying(false)
                  setIndex(position)
                }}
                className={`shrink-0 overflow-hidden rounded border-2 ${
                  position === frameIndex ? 'border-sky-400' : 'border-transparent opacity-70 hover:opacity-100'
                }`}
                title={formatTimeUTC(item.date)}
              >
                <img src={item.urls.thumb} alt="" loading="lazy" className="size-14 bg-black object-cover" />
              </button>
            ))}
          </div>
        )}
      </Panel>

      <div className="flex flex-col gap-4">
        <Panel title="Date">
          {datesQuery.error ? (
            <ErrorNotice error={datesQuery.error} onRetry={datesQuery.reload} />
          ) : !dates || !date ? (
            <Spinner label="Chargement des dates disponibles…" />
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                <Button onClick={() => goToDate(dates[dateIndex + 1])} disabled={dateIndex >= dates.length - 1} title="Jour précédent">
                  ‹
                </Button>
                <input
                  type="date"
                  className={`${inputClass} min-w-0 flex-1`}
                  value={date}
                  min={dates[dates.length - 1]}
                  max={dates[0]}
                  onChange={(event) => pickDate(event.target.value)}
                />
                <Button onClick={() => goToDate(dates[dateIndex - 1])} disabled={dateIndex <= 0} title="Jour suivant">
                  ›
                </Button>
              </div>
              <Button onClick={() => goToDate(dates[0])} disabled={dateIndex === 0}>
                Dernière journée disponible
              </Button>
              <p className="text-xs text-slate-500">
                {dates.length.toLocaleString('fr-FR')} journées d’images depuis le {formatDay(dates[dates.length - 1])}.
              </p>
            </div>
          )}
        </Panel>

        <Panel title="Défilement temporel">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-1.5">
              <Button active={mode === 'day'} onClick={() => switchMode('day')}>
                Rotation du jour
              </Button>
              <Button active={mode === 'series'} onClick={() => switchMode('series')} disabled={!frame && mode === 'day'}>
                Jour après jour
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              {mode === 'day'
                ? 'Toutes les prises de vue de la journée : la Terre tourne sous le satellite.'
                : `Une image par jour, centrée vers ${formatCoord(anchorLon, 'E', 'O')}, sur les ${seriesDays} derniers jours disponibles.`}
            </p>
            {mode === 'series' && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400">Durée</span>
                {SERIES_LENGTHS.map((days) => (
                  <Button
                    key={days}
                    active={seriesDays === days}
                    onClick={() => {
                      setSeriesDays(days)
                      setIndex(Number.MAX_SAFE_INTEGER)
                    }}
                  >
                    {days} j
                  </Button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400">Vitesse</span>
              {SPEEDS.map((speed) => (
                <Button key={speed} active={fps === speed} onClick={() => setFps(speed)}>
                  {speed} img/s
                </Button>
              ))}
            </div>
            {frames.length > 0 && preloaded < frames.length && (
              <p className="text-xs text-slate-400">
                Préchargement : {preloaded} / {frames.length} images
              </p>
            )}
            {activeQuery.error && <ErrorNotice error={activeQuery.error} onRetry={activeQuery.reload} />}
          </div>
        </Panel>

        <Panel title="Image">
          <div className="mb-3 grid grid-cols-2 gap-1.5">
            <Button active={collection === 'natural'} onClick={() => setCollection('natural')}>
              Couleurs naturelles
            </Button>
            <Button active={collection === 'enhanced'} onClick={() => setCollection('enhanced')}>
              Couleurs renforcées
            </Button>
          </div>
          {frame ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-slate-400">Prise de vue</dt>
              <dd>
                {formatDay(frame.date)}, {formatTimeUTC(frame.date)}
              </dd>
              <dt className="text-slate-400">Centre</dt>
              <dd>
                {formatCoord(frame.centroid.lat, 'N', 'S')}, {formatCoord(frame.centroid.lon, 'E', 'O')}
              </dd>
              <dt className="text-slate-400">Identifiant</dt>
              <dd className="truncate">{frame.image}</dd>
              <dt className="text-slate-400">Fichier</dt>
              <dd>
                <a href={frame.urls.png} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
                  PNG pleine résolution (2048 px)
                </a>
              </dd>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">—</p>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Caméra EPIC du satellite DSCOVR, à 1,5 million de km de la Terre (point de Lagrange L1).
          </p>
        </Panel>
      </div>
    </div>
  )
}
