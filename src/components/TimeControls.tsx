import { ISO_DATE, addDays, addMonths, clampDate } from '../lib/dates'
import { Button, inputClass } from './ui'

interface Props {
  label?: string
  date: string
  min: string
  max: string
  onChange: (date: string) => void
  playing?: boolean
  onTogglePlay?: () => void
}

/** Sélecteur de date avec pas d'un jour / d'un mois et lecture automatique optionnelle. */
export function TimeControls({ label, date, min, max, onChange, playing, onTogglePlay }: Props) {
  const move = (next: string) => onChange(clampDate(next, min, max))

  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="text-xs text-slate-400">{label}</span>}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button onClick={() => move(addMonths(date, -1))} disabled={date <= min} title="Mois précédent">
          «
        </Button>
        <Button onClick={() => move(addDays(date, -1))} disabled={date <= min} title="Jour précédent">
          ‹
        </Button>
        <input
          type="date"
          className={`${inputClass} min-w-0 flex-1`}
          value={date}
          min={min}
          max={max}
          onChange={(event) => {
            if (ISO_DATE.test(event.target.value)) move(event.target.value)
          }}
        />
        <Button onClick={() => move(addDays(date, 1))} disabled={date >= max} title="Jour suivant">
          ›
        </Button>
        <Button onClick={() => move(addMonths(date, 1))} disabled={date >= max} title="Mois suivant">
          »
        </Button>
        {onTogglePlay && (
          <Button onClick={onTogglePlay} active={playing} title="Faire défiler les jours">
            {playing ? '⏸ Pause' : '▶ Défiler'}
          </Button>
        )}
      </div>
    </div>
  )
}
