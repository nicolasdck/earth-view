import { useEffect, useState } from 'react'

/** Renvoie `value` une fois qu'elle n'a plus changé pendant `delayMs`. */
export function useDebounced<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
