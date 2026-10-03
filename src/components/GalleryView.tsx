import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { LibraryImage } from '../api/client'
import { useApi } from '../hooks/useApi'
import { useDebounced } from '../hooks/useDebounced'
import { formatDay } from '../lib/dates'
import { Button, ErrorNotice, Panel, Spinner, inputClass } from './ui'

const PAGE_SIZE = 24
// La photothèque ne pagine pas au-delà de 10 000 résultats.
const MAX_RESULTS = 10000
const CURRENT_YEAR = new Date().getFullYear()

const THEMES = [
  { label: 'La Terre vue de l’espace', query: 'Earth from space' },
  { label: 'Depuis la Station spatiale', query: 'ISS Earth observation' },
  { label: 'Aurores', query: 'aurora from space' },
  { label: 'Ouragans', query: 'hurricane from space' },
  { label: 'Villes de nuit', query: 'city lights at night from space' },
  { label: 'Blue Marble', query: 'Blue Marble' },
  { label: 'Lever de Terre', query: 'Earthrise' },
  { label: 'Volcans', query: 'volcano eruption from space' },
]

const PERIODS = [
  { label: 'Toutes les époques', start: undefined, end: undefined },
  { label: 'Apollo (1961-1975)', start: 1961, end: 1975 },
  { label: 'Navette (1981-2011)', start: 1981, end: 2011 },
  { label: 'Depuis 2012', start: 2012, end: CURRENT_YEAR },
]

function Lightbox({
  image,
  onClose,
  onStep,
}: {
  image: LibraryImage
  onClose: () => void
  onStep: (delta: number) => void
}) {
  const files = useApi(`image-files:${image.id}`, (signal) => api.imageFiles(image.id, signal))
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowLeft') onStep(-1)
      else if (event.key === 'ArrowRight') onStep(1)
    }
    window.addEventListener('keydown', onKey)
    // La page ne doit pas défiler derrière la visionneuse.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose, onStep])

  const display = files.data?.display ?? null
  const sharp = display !== null && loadedUrl === display

  return (
    <div
      className="fixed inset-0 z-[1300] flex flex-col bg-black/95 lg:flex-row"
      role="dialog"
      aria-modal="true"
      aria-label={image.title}
      onClick={onClose}
    >
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-3">
        {/* La vignette s'affiche tout de suite ; l'image en grande taille la remplace une fois chargée. */}
        <img
          src={image.thumb}
          alt={image.title}
          className={`max-h-full max-w-full object-contain ${sharp ? 'hidden' : 'blur-[1px]'}`}
          onClick={(event) => event.stopPropagation()}
        />
        {display && (
          <img
            key={display}
            src={display}
            alt={image.title}
            className={`max-h-full max-w-full object-contain ${sharp ? '' : 'hidden'}`}
            onLoad={() => setLoadedUrl(display)}
            onClick={(event) => event.stopPropagation()}
          />
        )}
        {!sharp && !files.error && (
          <div className="absolute bottom-4 rounded bg-black/70 px-2 py-1">
            <Spinner label="Chargement en haute définition…" />
          </div>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onStep(-1)
          }}
          className="absolute left-2 rounded-full bg-black/60 px-3 py-2 text-xl text-white hover:bg-black/90"
          aria-label="Image précédente"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onStep(1)
          }}
          className="absolute right-2 rounded-full bg-black/60 px-3 py-2 text-xl text-white hover:bg-black/90"
          aria-label="Image suivante"
        >
          ›
        </button>
      </div>

      <aside
        className="flex max-h-[40vh] shrink-0 flex-col gap-3 overflow-y-auto border-slate-800 bg-slate-950 p-4 lg:max-h-none lg:w-96 lg:border-l"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-100">{image.title}</h2>
          <Button onClick={onClose} aria-label="Fermer">
            ✕
          </Button>
        </div>
        <p className="text-xs text-slate-400">
          {[image.date && formatDay(image.date), image.center && `NASA ${image.center}`, image.photographer, image.location]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {image.description && <p className="text-sm leading-relaxed text-slate-300">{image.description}</p>}
        {image.keywords.length > 0 && (
          <p className="text-xs text-slate-500">{image.keywords.join(' · ')}</p>
        )}
        {files.error && <ErrorNotice error={files.error} onRetry={files.reload} />}
        <div className="flex flex-wrap gap-3 text-sm">
          {files.data?.original && (
            <a href={files.data.original} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
              Fichier original
            </a>
          )}
          <a href={image.detailsUrl} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
            Fiche sur images.nasa.gov
          </a>
        </div>
      </aside>
    </div>
  )
}

export function GalleryView() {
  const [text, setText] = useState(THEMES[0].query)
  const [period, setPeriod] = useState(0)
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)

  const query = useDebounced(text.trim(), 400)
  const search = {
    q: query,
    page,
    pageSize: PAGE_SIZE,
    yearStart: PERIODS[period].start,
    yearEnd: PERIODS[period].end,
  }
  const result = useApi(query ? `gallery:${JSON.stringify(search)}` : null, (signal) => api.imageSearch(search, signal))

  const data = result.data ?? result.stale
  const items = data?.items ?? []
  const pageCount = data ? Math.max(1, Math.ceil(Math.min(data.hits, MAX_RESULTS) / PAGE_SIZE)) : 1
  const openIndex = openId ? items.findIndex((item) => item.id === openId) : -1
  const openImage = openIndex >= 0 ? items[openIndex] : null

  const runSearch = (value: string) => {
    setText(value)
    setPage(1)
  }

  const step = (delta: number) => {
    if (items.length === 0 || openIndex < 0) return
    setOpenId(items[(openIndex + delta + items.length) % items.length].id)
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Photothèque de la NASA">
        <div className="flex flex-col gap-3">
          <input
            type="search"
            className={`${inputClass} w-full`}
            placeholder="Mots-clés (en anglais) : aurora, Sahara from space, Apollo 17…"
            value={text}
            onChange={(event) => runSearch(event.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            {THEMES.map((theme) => (
              <Button
                key={theme.query}
                className="!px-2 !py-1 !text-xs"
                active={text === theme.query}
                onClick={() => runSearch(theme.query)}
              >
                {theme.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-400">Époque</span>
            {PERIODS.map((item, index) => (
              <Button
                key={item.label}
                className="!px-2 !py-1 !text-xs"
                active={period === index}
                onClick={() => {
                  setPeriod(index)
                  setPage(1)
                }}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>
      </Panel>

      {result.error && <ErrorNotice error={result.error} onRetry={result.reload} />}
      {!query && <p className="text-sm text-slate-400">Saisissez des mots-clés ou choisissez un thème.</p>}

      {query && data && (
        <>
          <div className="flex items-center justify-between gap-3 text-sm text-slate-400">
            <span>
              {data.hits.toLocaleString('fr-FR')} images pour « {query} »
            </span>
            {result.loading && <Spinner />}
          </div>

          {items.length === 0 ? (
            <Panel>
              <p className="text-sm text-slate-400">Aucune image. Essayez d’autres mots-clés ou une autre époque.</p>
            </Panel>
          ) : (
            <ul
              className={`grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 ${result.loading ? 'opacity-60' : ''}`}
            >
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(item.id)}
                    className="group relative block aspect-square w-full overflow-hidden rounded-lg bg-slate-900"
                    title={item.title}
                  >
                    <img
                      src={item.thumb}
                      alt={item.title}
                      loading="lazy"
                      className="size-full object-cover transition group-hover:scale-105"
                    />
                    <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/85 to-transparent px-2 pt-6 pb-1.5 text-left text-xs text-slate-100">
                      {item.title}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-center gap-3">
            <Button onClick={() => setPage(page - 1)} disabled={page <= 1}>
              ‹ Précédent
            </Button>
            <span className="text-sm text-slate-400 tabular-nums">
              Page {page} / {pageCount.toLocaleString('fr-FR')}
            </span>
            <Button onClick={() => setPage(page + 1)} disabled={page >= pageCount}>
              Suivant ›
            </Button>
          </div>
        </>
      )}

      {query && !data && result.loading && <Spinner label="Recherche dans la photothèque…" />}

      {openImage && <Lightbox key={openImage.id} image={openImage} onClose={() => setOpenId(null)} onStep={step} />}
    </div>
  )
}
