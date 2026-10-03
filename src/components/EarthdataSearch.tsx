import { useState } from 'react'
import { api } from '../api/client'
import type { EarthdataCollection } from '../api/client'
import { useApi } from '../hooks/useApi'
import { useDebounced } from '../hooks/useDebounced'
import { ISO_DATE } from '../lib/dates'
import { Button, ErrorNotice, Panel, Spinner, inputClass } from './ui'

const PAGE_SIZE = 12
const GRANULE_COUNT = 8
const SUGGESTIONS = ['Landsat', 'sea surface temperature', 'active fire', 'cloud fraction', 'NDVI', 'precipitation']

const year = (iso: string | null) => (iso ? iso.slice(0, 4) : null)

function formatDateTime(iso: string | null) {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : '—'
}

function GranuleList({ collectionId }: { collectionId: string }) {
  const query = useApi(`granules:${collectionId}`, (signal) => api.granules(collectionId, GRANULE_COUNT, signal))

  if (query.error) return <ErrorNotice error={query.error} onRetry={query.reload} />
  if (!query.data) return <Spinner label="Chargement des fichiers…" />
  if (query.data.items.length === 0) return <p className="text-sm text-slate-400">Aucun fichier listé.</p>

  return (
    <div>
      <p className="mb-2 text-xs text-slate-400">
        {query.data.hits.toLocaleString('fr-FR')} fichiers au total — les {query.data.items.length} plus récents :
      </p>
      <ul className="flex flex-col gap-2">
        {query.data.items.map((granule) => (
          <li key={granule.id} className="flex items-center gap-3 rounded-lg bg-slate-950/60 p-2">
            {granule.browseUrl && (
              <img
                src={granule.browseUrl}
                alt=""
                loading="lazy"
                className="size-14 shrink-0 rounded bg-black object-cover"
              />
            )}
            <div className="min-w-0 flex-1 text-xs">
              <p className="truncate text-sm text-slate-200" title={granule.title}>
                {granule.title}
              </p>
              <p className="text-slate-400">
                {formatDateTime(granule.timeStart)}
                {granule.cloudCover !== null && ` · ${Math.round(granule.cloudCover)} % de nuages`}
                {granule.sizeMB !== null && ` · ${granule.sizeMB.toFixed(1)} Mo`}
              </p>
            </div>
            {granule.dataUrl && (
              <a
                href={granule.dataUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-xs text-sky-300 hover:underline"
                title="Le téléchargement nécessite un compte Earthdata Login"
              >
                Données
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function CollectionCard({ collection }: { collection: EarthdataCollection }) {
  const [open, setOpen] = useState(false)
  const start = year(collection.timeStart)
  const period = start ? `${start} – ${year(collection.timeEnd) ?? 'en cours'}` : null

  return (
    <li className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex gap-3">
        {collection.thumbnail && (
          <img
            src={collection.thumbnail}
            alt=""
            loading="lazy"
            className="hidden size-20 shrink-0 rounded bg-black object-cover sm:block"
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-100">{collection.title}</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            {[
              `${collection.shortName}${collection.version ? ` v${collection.version}` : ''}`,
              collection.dataCenter,
              period,
              collection.processingLevel && `niveau ${collection.processingLevel}`,
              collection.platforms.slice(0, 3).join(', '),
              collection.cloudHosted && 'hébergé dans le cloud',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="mt-2 line-clamp-3 text-sm text-slate-300">{collection.summary}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            <Button className="!px-2 !py-1 !text-xs" active={open} onClick={() => setOpen((value) => !value)}>
              {open ? 'Masquer les fichiers' : 'Fichiers récents'}
            </Button>
            <a href={collection.earthdataSearchUrl} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
              Ouvrir dans Earthdata Search
            </a>
            {collection.infoUrl && (
              <a href={collection.infoUrl} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
                Documentation
              </a>
            )}
          </div>
        </div>
      </div>
      {open && (
        <div className="mt-3 border-t border-slate-800 pt-3">
          <GranuleList collectionId={collection.id} />
        </div>
      )}
    </li>
  )
}

export function EarthdataSearch() {
  const [keyword, setKeyword] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [cloudHosted, setCloudHosted] = useState(false)
  const [page, setPage] = useState(1)

  // Anti-rebond : la recherche part 400 ms après la dernière frappe.
  const debouncedKeyword = useDebounced(keyword.trim(), 400)
  const search = {
    keyword: debouncedKeyword,
    page,
    pageSize: PAGE_SIZE,
    start: ISO_DATE.test(start) ? start : undefined,
    end: ISO_DATE.test(end) ? end : undefined,
    cloudHosted,
  }
  const query = useApi(`collections:${JSON.stringify(search)}`, (signal) => api.collections(search, signal))

  const result = query.data ?? query.stale
  // CMR ne pagine pas au-delà d'un million de résultats ; le serveur limite à 500 pages.
  const pageCount = result ? Math.min(500, Math.max(1, Math.ceil(result.hits / PAGE_SIZE))) : 1

  const update = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value)
    setPage(1)
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <Panel title="Jeux de données d’observation de la Terre">
        <div className="flex flex-col gap-3">
          <input
            type="search"
            className={`${inputClass} w-full`}
            placeholder="Mots-clés (en anglais) : landsat, sea ice, aerosol…"
            value={keyword}
            onChange={(event) => update(setKeyword)(event.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((suggestion) => (
              <Button key={suggestion} className="!px-2 !py-1 !text-xs" onClick={() => update(setKeyword)(suggestion)}>
                {suggestion}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Données à partir du
              <input
                type="date"
                className={inputClass}
                value={start}
                onChange={(event) => update(setStart)(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              jusqu’au
              <input
                type="date"
                className={inputClass}
                value={end}
                onChange={(event) => update(setEnd)(event.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 pb-1.5 text-sm">
              <input
                type="checkbox"
                className="accent-sky-400"
                checked={cloudHosted}
                onChange={(event) => update(setCloudHosted)(event.target.checked)}
              />
              Hébergés dans le cloud uniquement
            </label>
          </div>
        </div>
      </Panel>

      {query.error && <ErrorNotice error={query.error} onRetry={query.reload} />}

      {result && (
        <>
          <div className="flex items-center justify-between gap-3 text-sm text-slate-400">
            <span>
              {result.hits.toLocaleString('fr-FR')} jeux de données
              {debouncedKeyword ? ` pour « ${debouncedKeyword} »` : ' (les plus utilisés)'}
            </span>
            {query.loading && <Spinner />}
          </div>

          {result.items.length === 0 ? (
            <Panel>
              <p className="text-sm text-slate-400">Aucun résultat. Essayez d’autres mots-clés ou élargissez la période.</p>
            </Panel>
          ) : (
            <ul className={`flex flex-col gap-3 ${query.loading ? 'opacity-60' : ''}`}>
              {result.items.map((collection) => (
                <CollectionCard key={collection.id} collection={collection} />
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

      {!result && query.loading && <Spinner label="Recherche dans le catalogue Earthdata…" />}
    </div>
  )
}
