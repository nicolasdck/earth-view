import { useState } from 'react'
import type { ReactNode } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { isIosSafari, isStandalone, promptInstall, useCanInstall } from '../pwa/installPrompt'

const DISMISS_KEY = 'earth-view:install-dismissed-at'
// Après un refus, la bannière d'installation n'est plus proposée pendant 14 jours.
const DISMISS_DURATION_MS = 14 * 24 * 60 * 60 * 1000
// Les sessions longues vérifient régulièrement si une nouvelle version est publiée.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

function wasRecentlyDismissed() {
  try {
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY))
    return dismissedAt > 0 && Date.now() - dismissedAt < DISMISS_DURATION_MS
  } catch {
    return false
  }
}

function rememberDismissal() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  } catch {
    // stockage indisponible (navigation privée) : la bannière reviendra à la prochaine visite
  }
}

function Banner({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <div
      role="status"
      className="pointer-events-auto flex w-full max-w-xl flex-wrap items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-2xl shadow-black/60"
    >
      <img src="/icons/icon-192.png" alt="" className="size-10 shrink-0" />
      <div className="min-w-40 flex-1">
        <p className="text-sm font-semibold text-slate-100">{title}</p>
        <p className="text-xs text-slate-400">{children}</p>
      </div>
      <div className="flex gap-1.5">{actions}</div>
    </div>
  )
}

const primaryButton = 'rounded-md bg-sky-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-sky-400'
const secondaryButton = 'rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800'

function UpdateBanner() {
  const [updating, setUpdating] = useState(false)
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_scriptUrl, registration) {
      if (!registration) return
      setInterval(() => {
        if (navigator.onLine) registration.update().catch(() => {})
      }, UPDATE_CHECK_INTERVAL_MS)
    },
    onRegisterError(error) {
      console.error('Enregistrement du service worker impossible :', error)
    },
  })

  if (!needRefresh) return null

  return (
    <Banner
      title="Nouvelle version disponible"
      actions={
        <>
          <button type="button" className={secondaryButton} onClick={() => setNeedRefresh(false)} disabled={updating}>
            Plus tard
          </button>
          <button
            type="button"
            className={primaryButton}
            disabled={updating}
            onClick={() => {
              setUpdating(true)
              // Active le nouveau service worker puis recharge la page.
              void updateServiceWorker(true)
            }}
          >
            {updating ? 'Mise à jour…' : 'Mettre à jour'}
          </button>
        </>
      }
    >
      Rechargez l’application pour en profiter.
    </Banner>
  )
}

function InstallBanner() {
  const canInstall = useCanInstall()
  const [dismissed, setDismissed] = useState(wasRecentlyDismissed)
  const [standalone] = useState(isStandalone)
  const [ios] = useState(isIosSafari)

  if (dismissed || standalone || (!canInstall && !ios)) return null

  const dismiss = () => {
    rememberDismissal()
    setDismissed(true)
  }

  return (
    <Banner
      title="Installer Earth View"
      actions={
        <>
          <button type="button" className={secondaryButton} onClick={dismiss}>
            {canInstall ? 'Plus tard' : 'Fermer'}
          </button>
          {canInstall && (
            <button
              type="button"
              className={primaryButton}
              onClick={async () => {
                // Un refus dans la fenêtre du navigateur vaut « Plus tard ».
                if (!(await promptInstall())) dismiss()
              }}
            >
              Installer
            </button>
          )}
        </>
      }
    >
      {canInstall
        ? 'Accès direct depuis l’écran d’accueil ou le bureau, en plein écran.'
        : 'Touchez le bouton Partager de Safari, puis « Sur l’écran d’accueil ».'}
    </Banner>
  )
}

export function PwaBanners() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[1200] flex flex-col items-center gap-2 p-3">
      <UpdateBanner />
      <InstallBanner />
    </div>
  )
}
