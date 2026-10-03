import { HttpError } from './http.js'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function parseDate(value, name, { required = true, fallback } = {}) {
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback
    if (!required) return undefined
    throw new HttpError(400, `Paramètre « ${name} » manquant (format AAAA-MM-JJ).`)
  }
  if (typeof value !== 'string' || !ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new HttpError(400, `Paramètre « ${name} » invalide : format attendu AAAA-MM-JJ.`)
  }
  return value
}

export function parseNumber(value, name, { min, max, fallback, integer = false } = {}) {
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback
    throw new HttpError(400, `Paramètre « ${name} » manquant.`)
  }
  const number = Number(value)
  if (typeof value !== 'string' || !Number.isFinite(number) || (integer && !Number.isInteger(number))) {
    throw new HttpError(400, `Paramètre « ${name} » invalide : nombre attendu.`)
  }
  if ((min !== undefined && number < min) || (max !== undefined && number > max)) {
    throw new HttpError(400, `Paramètre « ${name} » hors limites (${min} à ${max}).`)
  }
  return number
}

export function parseString(value, name, { maxLength = 200, fallback = '' } = {}) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new HttpError(400, `Paramètre « ${name} » invalide.`)
  }
  return value.trim()
}
