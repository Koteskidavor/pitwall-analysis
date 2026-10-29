import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Provider } from 'react-redux'
import type { Lap, PitStop, Stint } from '@pitwall/shared'
import { DRIVER_STATUS, type EngineSnapshot, type MotionSample, type SnapshotListener } from '../engine'
import { EngineProvider, type EngineSnapshotSource } from '../engineContext'
import { createAppStore } from '../store'
import { Leaderboard } from '../features/leaderboard/Leaderboard'

const laps: Lap[] = [
  {
    driverId: 'VER',
    lap: 1,
    lap_time_ms: 90000,
    lap_start_ms: 0,
    lap_end_ms: 90000,
    s1_ms: null,
    s2_ms: null,
    s3_ms: null,
    position: 1,
    compound: 'HARD',
    tyre_age: 4,
    is_accurate: true,
    is_pit_in: false,
    is_pit_out: false,
  },
  {
    driverId: 'HAM',
    lap: 1,
    lap_time_ms: 91000,
    lap_start_ms: 0,
    lap_end_ms: 91000,
    s1_ms: null,
    s2_ms: null,
    s3_ms: null,
    position: 2,
    compound: 'SOFT',
    tyre_age: 2,
    is_accurate: true,
    is_pit_in: false,
    is_pit_out: false,
  },
]

const stints: Stint[] = [
  { driverId: 'VER', lapStart: 1, lapEnd: 50, compound: 'HARD', tyreAgeAtStart: 1 },
  { driverId: 'HAM', lapStart: 1, lapEnd: 50, compound: 'SOFT', tyreAgeAtStart: 1 },
]

const pitStops: PitStop[] = [{ driverId: 'HAM', lap: 1, time_ms: 80000, duration_ms: 2400 }]

const samples: MotionSample[] = [
  { driverId: 'VER', progress: 40, x: 0, y: 0, speed: 0, status: DRIVER_STATUS.RUNNING },
  { driverId: 'HAM', progress: 10, x: 0, y: 0, speed: 0, status: DRIVER_STATUS.PIT },
]

function makeSource(): EngineSnapshotSource & {
  push: (next: Partial<EngineSnapshot>) => void
} {
  let snapshot: EngineSnapshot = {
    timeMs: 95000,
    durationMs: 200000,
    speed: 1,
    playing: false,
    ended: false,
    ready: true,
    samples,
  }
  const listeners = new Set<SnapshotListener>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: SnapshotListener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    push: (next) => {
      snapshot = { ...snapshot, ...next }
      listeners.forEach((listener) => listener(snapshot))
    },
  }
}

describe('CP12: Leaderboard component', () => {
  it('renders the running order with tyre and pit info', () => {
    const store = createAppStore()
    render(
      <Provider store={store}>
        <EngineProvider engine={makeSource()}>
          <Leaderboard laps={laps} stints={stints} pitStops={pitStops} />
        </EngineProvider>
      </Provider>,
    )

    const rows = screen.getAllByTestId(/leaderboard-row-/)
    expect(rows.map((row) => row.getAttribute('data-position'))).toEqual(['1', '2'])
    expect(screen.getByTestId('leaderboard-row-VER')).toHaveAttribute('data-position', '1')

    // Tyre compound badge and pit counter.
    expect(screen.getByTestId('leaderboard-row-HAM')).toHaveTextContent('S')
    expect(screen.getByTestId('leaderboard-row-HAM')).toHaveTextContent('1')
    // HAM is flagged as in the pit lane from its motion status.
    expect(screen.getByTitle('In pit lane')).toBeInTheDocument()
  })

  it('shows the interval to the car ahead and the gap to the leader', () => {
    const source = makeSource()
    const store = createAppStore()
    render(
      <Provider store={store}>
        <EngineProvider engine={source}>
          <Leaderboard laps={laps} stints={stints} pitStops={pitStops} />
        </EngineProvider>
      </Provider>,
    )

    // At t=95000 VER has completed lap 1 at 90000ms and HAM at 91000ms, so the
    // gap is live and the leader row is labelled rather than showing "+0.000".
    expect(screen.getByTestId('leaderboard-row-VER')).toHaveTextContent('LEADER')
    expect(screen.getByTestId('leaderboard-row-HAM')).toHaveTextContent('+1.000')
    // The gap to the leader is shown alongside the interval on non-leader rows.
    expect(screen.getByTestId('leaderboard-row-HAM')).toHaveTextContent('+1.000+1.000')
  })

  it('stores the clicked driver as the selection', () => {
    const store = createAppStore()
    render(
      <Provider store={store}>
        <EngineProvider engine={makeSource()}>
          <Leaderboard laps={laps} stints={stints} pitStops={pitStops} />
        </EngineProvider>
      </Provider>,
    )

    fireEvent.click(screen.getByTestId('leaderboard-row-HAM'))

    expect(store.getState().ui.selectedDriverId).toBe('HAM')
  })
})
