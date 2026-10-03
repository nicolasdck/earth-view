import { useSyncExternalStore } from 'react'

/** Événement Chromium (Chrome, Edge, Android) qui permet de déclencher l'installation. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

// Écoute posée dès le chargement du module (importé par main.tsx) : l'événement peut
// être émis avant le montage de React, et il ne l'est qu'une fois.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  deferredPrompt = event as BeforeInstallPromptEvent
  notify()
})

window.addEventListener('appinstalled', () => {
  deferredPrompt = null
  notify()
})

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Vrai quand le navigateur propose l'installation et qu'elle peut être déclenchée. */
export function useCanInstall() {
  return useSyncExternalStore(subscribe, () => deferredPrompt !== null)
}

export async function promptInstall() {
  const event = deferredPrompt
  if (!event) return false
  // Un même événement ne peut servir qu'une fois.
  deferredPrompt = null
  notify()
  await event.prompt()
  const { outcome } = await event.userChoice
  return outcome === 'accepted'
}

export function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** Safari sur iOS n'émet pas beforeinstallprompt : l'installation passe par le menu Partager. */
export function isIosSafari() {
  const agent = navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return ios && /Safari/.test(agent) && !/CriOS|FxiOS|EdgiOS/.test(agent)
}
