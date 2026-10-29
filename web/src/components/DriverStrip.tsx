import React from 'react'
import { carNumberFor } from '../driverMeta'
import { teamColor } from '../teamColors'
import { formatSurname } from '../format'

export interface DriverStripProps {
  order: string[]
  names: Record<string, string>
  selectedDriverId: string | null
  onSelect: (driverId: string) => void
}

// Horizontal row of driver chips in grid order. Selection is shared with the
// map, tables and leaderboard through Redux (mirrored into ?driver=).
export const DriverStrip: React.FC<DriverStripProps> = ({
  order,
  names,
  selectedDriverId,
  onSelect,
}) => {
  return (
    <div className="driver-strip" role="group" aria-label="Drivers">
      {order.map((driverId, index) => {
        const number = carNumberFor(driverId)
        return (
          <button
            key={driverId}
            type="button"
            className="driver-chip"
            style={{ '--chip-color': teamColor(driverId) } as React.CSSProperties}
            aria-pressed={driverId === selectedDriverId}
            onClick={() => onSelect(driverId)}
            data-testid={`driver-chip-${driverId}`}
          >
            <span className="driver-chip__top">
              <span className="driver-chip__pos mono">{index + 1}</span>
              <span className="driver-chip__code">{driverId}</span>
              <span className="driver-chip__num mono">{number ?? '—'}</span>
            </span>
            <span className="driver-chip__name">{formatSurname(names[driverId])}</span>
          </button>
        )
      })}
    </div>
  )
}
