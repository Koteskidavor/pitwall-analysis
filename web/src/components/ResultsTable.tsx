import React from 'react'
import type { Result } from '@pitwall/shared'
import { Panel } from './Panel'
import { formatGap, formatRaceClock } from '../format'
import { teamColor, teamFor } from '../teamColors'

export interface ResultsTableProps {
  results: Result[]
  names: Record<string, string>
  selectedDriverId: string | null
  onSelect: (driverId: string) => void
}

function finishLabel(result: Result): string {
  if (result.gap_ms !== null && result.gap_ms !== undefined) return formatGap(result.gap_ms)
  if (result.position === 1 && result.time_ms !== null) return formatRaceClock(result.time_ms)
  if (result.time_ms !== null) return formatGap(result.time_ms)
  return 'DNF'
}

// The classification is always final, so it does not change during replay.
export const ResultsTable: React.FC<ResultsTableProps> = ({
  results,
  names,
  selectedDriverId,
  onSelect,
}) => {
  const ordered = [...results].sort(
    (a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER),
  )

  return (
    <Panel title="Results" subtitle="Final classification">
      <div className="table-scroll">
        <table className="table" data-testid="results-table">
          <thead>
            <tr>
              <th scope="col">Pos</th>
              <th scope="col">Driver</th>
              <th scope="col">Team</th>
              <th scope="col">Grid</th>
              <th scope="col">Time / status</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((result) => {
              const driverId = result.driverId
              const team = teamFor(driverId)
              return (
                <tr
                  key={driverId}
                  data-testid={`result-row-${driverId}`}
                  data-selected={driverId === selectedDriverId}
                  onClick={() => onSelect(driverId)}
                >
                  <td>{result.position ?? '—'}</td>
                  <td className="cell-name">
                    <span
                      className="team-dot"
                      style={{ background: teamColor(driverId) }}
                      aria-hidden="true"
                    />
                    {driverId}
                    <span className="muted"> {names[driverId] ?? ''}</span>
                  </td>
                  <td className="cell-name muted">{team.name}</td>
                  <td>{result.grid_position ?? '—'}</td>
                  <td>{finishLabel(result)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
