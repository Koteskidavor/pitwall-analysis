import React, { useLayoutEffect, useMemo, useRef } from 'react'
import type { Lap, PitStop, Result, Stint } from '@pitwall/shared'
import { useEngineSnapshot } from '../../engineContext'
import { useAppDispatch, useAppSelector } from '../../store'
import { selectDriver, selectSelectedDriverId } from '../../uiSlice'
import { Badge } from '../../components/Badge'
import { Panel } from '../../components/Panel'
import { DRIVER_STATUS } from '../../engine'
import { teamColor } from '../../teamColors'
import type { GapTable } from './gaps'
import {
  buildLeaderboard,
  compoundLetter,
  compoundTone,
  formatGap,
} from './leaderboard'

export interface LeaderboardProps {
  laps: readonly Lap[]
  stints: readonly Stint[]
  pitStops: readonly PitStop[]
  gapTable?: GapTable | null
  driverOrder?: readonly string[]
  results?: readonly Result[]
  maxRows?: number
}

// Slide rows to their new place on overtakes by measuring before/after layout
// and playing a FLIP transform.
function useRowFlip(orderKey: string) {
  const containerRef = useRef<HTMLDivElement>(null)
  const previousTops = useRef(new Map<string, number>())

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const nodes = container.querySelectorAll<HTMLElement>('[data-driver]')

    nodes.forEach((node) => {
      const id = node.dataset.driver
      if (!id) return
      const top = node.getBoundingClientRect().top
      const previous = previousTops.current.get(id)
      if (previous !== undefined && Math.abs(previous - top) > 0.5) {
        const delta = previous - top
        node.style.transition = 'none'
        node.style.transform = `translateY(${delta}px)`
        requestAnimationFrame(() => {
          node.style.transition = 'transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)'
          node.style.transform = ''
        })
      }
      previousTops.current.set(id, top)
    })
  }, [orderKey])

  return containerRef
}

export const Leaderboard: React.FC<LeaderboardProps> = ({
  laps,
  stints,
  pitStops,
  gapTable = null,
  driverOrder,
  results,
  maxRows,
}) => {
  const dispatch = useAppDispatch()
  const selectedDriverId = useAppSelector(selectSelectedDriverId)
  const { timeMs, samples } = useEngineSnapshot()

  const entries = useMemo(
    () =>
      buildLeaderboard({
        timeMs,
        samples,
        laps,
        stints,
        pitStops,
        gapTable,
        driverOrder,
        results,
      }),
    [timeMs, samples, laps, stints, pitStops, gapTable, driverOrder, results],
  )

  const ordered = useMemo(() => {
    const active = entries.filter((entry) => entry.status !== DRIVER_STATUS.OUT)
    const retired = entries.filter((entry) => entry.status === DRIVER_STATUS.OUT)
    const combined = [...active, ...retired]
    return maxRows !== undefined ? combined.slice(0, maxRows) : combined
  }, [entries, maxRows])

  const orderKey = ordered.map((entry) => entry.driverId).join(',')
  const containerRef = useRowFlip(orderKey)

  return (
    <Panel title="Leaderboard" subtitle="Live gaps · interval to car ahead">
      <div className="leaderboard" data-testid="leaderboard" ref={containerRef}>
        {ordered.map((entry) => {
          const retired = entry.status === DRIVER_STATUS.OUT
          const leader = entry.position === 1
          return (
            <div
              key={entry.driverId}
              role="button"
              tabIndex={0}
              className="leaderboard__row"
              data-testid={`leaderboard-row-${entry.driverId}`}
              data-driver={entry.driverId}
              data-selected={entry.driverId === selectedDriverId}
              data-retired={retired}
              data-position={entry.position}
              style={{ '--row-color': teamColor(entry.driverId) } as React.CSSProperties}
              onClick={() => dispatch(selectDriver(entry.driverId))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  dispatch(selectDriver(entry.driverId))
                }
              }}
            >
              <span className="leaderboard__pos">{retired ? '–' : entry.position}</span>
              <span className="leaderboard__bar" aria-hidden="true" />
              <span className="leaderboard__code">{entry.driverId}</span>
              <span
                className="leaderboard__gap"
                title={
                  retired
                    ? 'Retired'
                    : leader
                      ? 'Race leader'
                      : `Interval +${((entry.intervalMs ?? 0) / 1000).toFixed(3)} to car ahead · +${((entry.gapMs ?? 0) / 1000).toFixed(3)} to leader`
                }
              >
                {retired ? (
                  <span className="leaderboard__out">OUT</span>
                ) : (
                  <>
                    <span className="leaderboard__interval">
                      {leader ? 'LEADER' : formatGap(entry.intervalMs)}
                    </span>
                    {!leader && (
                      <span className="leaderboard__gap-leader">{formatGap(entry.gapMs)}</span>
                    )}
                  </>
                )}
              </span>
              <span className="leaderboard__tyre">
                <Badge tone={compoundTone(entry.compound)} title={entry.compound ?? 'Unknown'}>
                  {compoundLetter(entry.compound)}
                </Badge>
                {entry.tyreAge !== null && (
                  <span className="muted"> {entry.tyreAge}L</span>
                )}
              </span>
              <span className="leaderboard__meta">
                {entry.inPit && (
                  <Badge tone="info" title="In pit lane">
                    PIT
                  </Badge>
                )}{' '}
                <span className="mono muted">{entry.pitCount}</span>
              </span>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
