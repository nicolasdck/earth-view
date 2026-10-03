import { useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../api/client'
import type { EarthQuery } from '../api/client'
import { useApi } from '../hooks/useApi'
import { ISO_DATE, addDays, formatDay, todayISO } from '../lib/dates'
import { Button, ErrorNotice, Panel, Spinner, inputClass } from './ui'

export interface LandsatRequest {
  lat: number
  lon: number
  date: string
}

interface Committed {
  lat: number
  lon: number
  dim: number
  dateA: string
  dateB: string | null
}

const PRESETS = [
  { name: 'Paris', lat: 48.8566, lon: 2.3522 },
  { name: 'Delta du Nil', lat: 30.9, lon: 31.1 },
  { name: 'Las Vegas', lat: 36.1699, lon: -115.1398 },
  { name: 'Rondônia (Amazonie)', lat: -10.3, lon: -62.9 },
  { name: 'Dubaï', lat: 25.2048, lon: 55.2708 },
]

const KM_PER_DEGREE = 111.32

function cloudLabel(cloudCover: number | null) {
  return cloudCover === null ? 'nuages : n/d' : `${Math.round(cloudCover)} % de nuages`
}

function LandsatCard({ label, query }: { label: string; query: EarthQuery }) {
  const assetQuery = useApi(`earth:${query.lat}:${query.lon}:${query.date}:${query.dim}`, (signal) =>
    api.earthAsset(query, signal),
  )
  const asset = assetQuery.data
  // Passage choisi manuellement parmi ceux proposés ; sinon celui retenu par le serveur.
  const [chosenPass, setChosenPass] = useState<string | null>(null)
  const [imageState, setImageState] = useState<{ url: string; status: 'loaded' | 'error' } | null>(null)

  const shownDate = chosenPass ?? asset?.date ?? null
  const imageUrl = !asset
    ? null
    : chosenPass
      ? api.earthImageUrl({ ...query, date: chosenPass }, 'hls')
      : asset.imageUrl
  const status = imageUrl && imageState?.url === imageUrl ? imageState.status : 'loading'
  const shownPass = asset?.passes.find((pass) => pass.date === shownDate)
  const cloudCover = shownPass ? shownPass.cloudCover : (asset?.cloudCover ?? null)

  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{label}</h3>
        <span className="text-xs text-slate-400">Demandé : {formatDay(query.date)}</span>
      </div>

      {assetQuery.error ? (
        <ErrorNotice error={assetQuery.error} onRetry={assetQuery.reload} />
      ) : !asset || !imageUrl ? (
        <div className="flex aspect-square items-center justify-center rounded-lg bg-black">
          <Spinner label="Recherche de l’acquisition la plus proche…" />
        </div>
      ) : (
        <>
          <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-black">
            <img
              key={imageUrl}
              src={imageUrl}
              alt={`Image Landsat du ${shownDate ? formatDay(shownDate) : ''} autour de ${query.lat}, ${query.lon}`}
              className={`size-full object-contain ${status === 'loaded' ? '' : 'opacity-0'}`}
              onLoad={() => setImageState({ url: imageUrl, status: 'loaded' })}
              onError={() => setImageState({ url: imageUrl, status: 'error' })}
            />
            {status === 'loading' && (
              <div className="absolute">
                <Spinner label="Chargement de l’image…" />
              </div>
            )}
            {status === 'error' && (
              <p className="absolute px-6 text-center text-sm text-rose-200">
                L’image n’a pas pu être chargée pour cette date.
              </p>
            )}
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-slate-400">Acquisition</dt>
            <dd>
              {shownDate && formatDay(shownDate)} · {cloudLabel(cloudCover)}
            </dd>
            <dt className="text-slate-400">Source</dt>
            <dd>{chosenPass ? 'GIBS — HLS Landsat 8/9 (30 m)' : asset.sourceLabel}</dd>
            <dt className="text-slate-400">Emprise</dt>
            <dd className="tabular-nums">
              {asset.bbox.south.toFixed(3)}° à {asset.bbox.north.toFixed(3)}° lat., {asset.bbox.west.toFixed(3)}° à{' '}
              {asset.bbox.east.toFixed(3)}° lon.
            </dd>
          </dl>

          {asset.passes.length > 1 && (
            <div>
              <p className="mb-1.5 text-xs text-slate-400">Autres passages du satellite (date · nuages)</p>
              <div className="flex flex-wrap gap-1.5">
                {asset.passes.map((pass) => (
                  <Button
                    key={pass.date}
                    active={pass.date === shownDate}
                    onClick={() => setChosenPass(pass.date === asset.date ? null : pass.date)}
                    className="!px-2 !py-1 !text-xs tabular-nums"
                  >
                    {pass.date} · {pass.cloudCover === null ? 'n/d' : `${Math.round(pass.cloudCover)} %`}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

export function LandsatView({ request }: { request: LandsatRequest | null }) {
  const today = todayISO()
  const [lat, setLat] = useState(() => String(request?.lat.toFixed(4) ?? PRESETS[0].lat))
  const [lon, setLon] = useState(() => String(request?.lon.toFixed(4) ?? PRESETS[0].lon))
  const [dim, setDim] = useState(0.15)
  const [dateA, setDateA] = useState(() => request?.date ?? addDays(todayISO(), -30))
  const [compare, setCompare] = useState(false)
  const [dateB, setDateB] = useState(() => addDays(todayISO(), -365 * 5))
  const [formError, setFormError] = useState<string | null>(null)
  const [committed, setCommitted] = useState<Committed | null>(() =>
    request ? { lat: request.lat, lon: request.lon, dim: 0.15, dateA: request.date, dateB: null } : null,
  )

  const commit = (latText: string, lonText: string) => {
    const latitude = Number(latText.replace(',', '.'))
    const longitude = Number(lonText.replace(',', '.'))
    if (latText.trim() === '' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      return setFormError('Latitude invalide : valeur attendue entre -90 et 90.')
    }
    if (lonText.trim() === '' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return setFormError('Longitude invalide : valeur attendue entre -180 et 180.')
    }
    if (!ISO_DATE.test(dateA) || (compare && !ISO_DATE.test(dateB))) {
      return setFormError('Date invalide.')
    }
    setFormError(null)
    setCommitted({
      lat: Number(latitude.toFixed(4)),
      lon: Number(longitude.toFixed(4)),
      dim,
      dateA,
      dateB: compare ? dateB : null,
    })
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    commit(lat, lon)
  }

  const cards = committed
    ? [
        { label: committed.dateB ? 'Date A' : 'Image', date: committed.dateA },
        ...(committed.dateB ? [{ label: 'Date B', date: committed.dateB }] : []),
      ]
    : []

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <Panel title="Recherche par coordonnées" className="self-start">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Latitude
              <input
                className={inputClass}
                inputMode="decimal"
                value={lat}
                onChange={(event) => setLat(event.target.value)}
                placeholder="48.8566"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Longitude
              <input
                className={inputClass}
                inputMode="decimal"
                value={lon}
                onChange={(event) => setLon(event.target.value)}
                placeholder="2.3522"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <Button
                key={preset.name}
                className="!px-2 !py-1 !text-xs"
                onClick={() => {
                  setLat(String(preset.lat))
                  setLon(String(preset.lon))
                  commit(String(preset.lat), String(preset.lon))
                }}
              >
                {preset.name}
              </Button>
            ))}
          </div>

          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Date
            <input
              type="date"
              className={inputClass}
              value={dateA}
              min="2013-04-11"
              max={today}
              onChange={(event) => setDateA(event.target.value)}
            />
          </label>

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
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Date B
              <input
                type="date"
                className={inputClass}
                value={dateB}
                min="2013-04-11"
                max={today}
                onChange={(event) => setDateB(event.target.value)}
              />
            </label>
          )}

          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Largeur de la zone : {dim.toFixed(2)}° (≈ {Math.round(dim * KM_PER_DEGREE)} km)
            <input
              type="range"
              className="accent-sky-400"
              min={0.05}
              max={0.6}
              step={0.05}
              value={dim}
              onChange={(event) => setDim(Number(event.target.value))}
            />
          </label>

          {formError && <p className="text-sm text-rose-300">{formError}</p>}

          <button
            type="submit"
            className="rounded-md bg-sky-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400"
          >
            Afficher l’imagerie
          </button>
          <p className="text-xs text-slate-500">
            Le serveur retient le passage Landsat le plus proche de la date demandée, en privilégiant un ciel dégagé
            (recherche à ±45 jours).
          </p>
        </form>
      </Panel>

      {committed ? (
        <div className={`grid gap-4 ${cards.length > 1 ? 'xl:grid-cols-2' : 'max-w-3xl'}`}>
          {cards.map((card) => {
            const query = { lat: committed.lat, lon: committed.lon, dim: committed.dim, date: card.date }
            return <LandsatCard key={`${card.label}:${JSON.stringify(query)}`} label={card.label} query={query} />
          })}
        </div>
      ) : (
        <Panel className="flex min-h-64 items-center justify-center self-start">
          <p className="max-w-md text-center text-sm text-slate-400">
            Saisissez des coordonnées et une date, choisissez un lieu prédéfini, ou cliquez un point sur la carte puis
            « Voir en Landsat ».
          </p>
        </Panel>
      )}
    </div>
  )
}
