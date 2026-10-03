const CATEGORY_COLORS: Record<string, string> = {
  wildfires: '#f97316',
  severeStorms: '#a78bfa',
  volcanoes: '#ef4444',
  seaLakeIce: '#67e8f9',
  floods: '#3b82f6',
  earthquakes: '#facc15',
  dustHaze: '#d6b98c',
  snow: '#e2e8f0',
}

const DEFAULT_COLOR = '#f472b6'

export function eventColor(category: string) {
  return CATEGORY_COLORS[category] ?? DEFAULT_COLOR
}
