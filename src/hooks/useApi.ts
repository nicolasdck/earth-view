import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'

interface State<T> {
  key: string | null
  data?: T
  error?: ApiError
}

/**
 * Charge une ressource identifiée par `key` (null = rien à charger).
 * La requête en cours est annulée quand la clé change ; `stale` conserve la dernière
 * réponse reçue pour éviter que l'interface ne se vide pendant un rechargement.
 */
export function useApi<T>(key: string | null, fetcher: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<State<T>>({ key: null })
  const [attempt, setAttempt] = useState(0)
  const fetcherRef = useRef(fetcher)

  useEffect(() => {
    fetcherRef.current = fetcher
  })

  const requestKey = key === null ? null : `${key}#${attempt}`

  useEffect(() => {
    if (requestKey === null) return
    const controller = new AbortController()
    fetcherRef.current(controller.signal).then(
      (data) => setState({ key: requestKey, data }),
      (err: unknown) => {
        if (controller.signal.aborted) return
        const error = err instanceof ApiError ? err : new ApiError(0, err instanceof Error ? err.message : 'Erreur inconnue')
        setState((previous) => ({ key: requestKey, data: previous.data, error }))
      },
    )
    return () => controller.abort()
  }, [requestKey])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  const settled = requestKey !== null && state.key === requestKey
  return {
    data: settled && !state.error ? state.data : undefined,
    error: settled ? state.error : undefined,
    loading: requestKey !== null && !settled,
    stale: state.data,
    reload,
  }
}
