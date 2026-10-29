import React from 'react'
import type { Lap } from '@pitwall/shared'
import { Panel } from './Panel'
import { Badge } from './Badge'
import { compoundLetter, compoundTone } from '../features/leaderboard/leaderboard'
import { formatLapTime } from '../format'

export interface LapTableProps {
  driverId: string | null
  laps: Lap[]
  currentLap: number | null
}

function noteFor(lap: Lap): React.ReactNode {
  const notes: React.ReactNode[] = []
  if (lap.lap === 1) notes.push(<span key="derived">derived</span>)
  if (lap.is_pit_in) notes.push(<Badge key="in" tone="info">pit in</Badge>)
  if (lap.is_pit_out) notes.push(<Badge key="out" tone="info">pit out</Badge>)
  if (!lap.is_accurate) {
    notes.push(
      <Badge key="acc" tone="danger" title="Timing flagged as inaccurate">
        flagged
      </Badge>,
    )
  }
  if (notes.length === 0) return <span className="muted">—</span>
  return <span className="lap-note">{notes}</span>
}

export const LapTable: React.FC<LapTableProps> = ({ driverId, laps, currentLap }) => {
  const ordered = [...laps].sort((a, b) => a.lap - b.lap)

  return (
    <Panel
      title="Laps"
      subtitle={driverId ? `${driverId} · ${ordered.length} laps` : 'Select a driver'}
    >
      {ordered.length === 0 ? (
        <p className="muted">
          {driverId ? 'No lap data for this driver.' : 'Pick a driver to see their laps.'}
        </p>
      ) : (
        <div className="table-scroll" data-testid="lap-table">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Lap</th>
                <th scope="col">Time</th>
                <th scope="col">Tyre</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((lap) => (
                <tr key={lap.lap} data-current={lap.lap === currentLap}>
                  <td>{lap.lap}</td>
                  <td>{formatLapTime(lap.lap_time_ms)}</td>
                  <td>
                    <Badge tone={compoundTone(lap.compound)} title={lap.compound ?? 'Unknown'}>
                      {compoundLetter(lap.compound)}
                    </Badge>
                  </td>
                  <td>{noteFor(lap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
