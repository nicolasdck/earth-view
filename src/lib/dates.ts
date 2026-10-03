const toISO = (date: Date) => date.toISOString().slice(0, 10)
const parse = (iso: string) => new Date(`${iso}T00:00:00Z`)

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function todayISO() {
  return toISO(new Date())
}

export function addDays(iso: string, days: number) {
  const date = parse(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return toISO(date)
}

export function addMonths(iso: string, months: number) {
  const date = parse(iso)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + months)
  // 31 mars + 1 mois → 30 avril, pas 1er mai.
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDay))
  return toISO(date)
}

export function clampDate(iso: string, min: string, max: string) {
  if (iso < min) return min
  if (iso > max) return max
  return iso
}

const dayFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' })
const timeFormat = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short', timeZone: 'UTC' })

export function formatDay(iso: string) {
  return dayFormat.format(parse(iso.slice(0, 10)))
}

export function formatTimeUTC(isoDateTime: string) {
  return `${timeFormat.format(new Date(isoDateTime))} UTC`
}
