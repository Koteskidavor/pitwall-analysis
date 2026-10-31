import { DRIVER_STATUS, type MotionSample } from '../../engine'
import type { BadgeTone } from '../../components/Badge'
import type { Lap, PitStop, Result, Stint } from '@pitwall/shared'
import { raceClockAt, type GapTable } from './gaps'

// Motion progress is authored on a 0..100 scale (see FORMAT.md). The absolute
// unit only matters for the fractional part of the ordering key, so any fixed
// positive scale preserves the order within a lap.
export const LAP_PROGRESS_UNITS = 100

export interface LeaderboardInputs {
  timeMs: number
  samples: readonly MotionSample[]
  laps: readonly Lap[]
  stints: readonly Stint[]
  pitStops: readonly PitStop[]
  gapTable?: GapTable | null
  driverOrder?: readonly string[]
  results?: readonly Result[]
}

export interface LeaderboardEntry {
  driverId: string
  position: number
  lapsCompleted: number
  lap: number
  progress: number
  progressFraction: number
  totalProgress: number
  status: number
  inPit: boolean
  compound: string | null
  tyreAge: number | null
  pitCount: number
  lastPitLap: number | null
  lastPitMs: number | null
  lastLapEndMs: number | null
  gapMs: number | null
  intervalMs: number | null
}

interface LapSummary {
  lapsCompleted: number
  lastLapEndMs: number | null
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function groupByDriver<T extends { driverId: string }>(rows: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const list = grouped.get(row.driverId)
    if (list) list.push(row)
    else grouped.set(row.driverId, [row])
  }
  return grouped
}

function summarizeLaps(laps: readonly Lap[], timeMs: number): LapSummary {
  let lapsCompleted = 0
  let lastLapEndMs: number | null = null

  for (const lap of laps) {
    if (lap.lap_end_ms > 0 && lap.lap_end_ms <= timeMs) {
      lapsCompleted += 1
      if (lastLapEndMs === null || lap.lap_end_ms > lastLapEndMs) {
        lastLapEndMs = lap.lap_end_ms
      }
    }
  }

  return { lapsCompleted, lastLapEndMs }
}

// Cumulative race-clock timing for one driver, built from real lap crossings.
// `rows` is sorted by lap; `end` is the race-clock time at the end of that lap
// and `dur` its duration. Gaps between drivers are derived from this instead of
// the synthetic gaps.bin table.
interface DriverTiming {
  rows: Array<{ lap: number; end: number; dur: number }>
  avgDur: number | null
}

function buildTiming(driverLaps: readonly Lap[]): DriverTiming {
  const rows = driverLaps
    .filter((lap) => lap.lap_end_ms > 0)
    .map((lap) => {
      const span = lap.lap_end_ms - lap.lap_start_ms
      const dur = span > 0 ? span : lap.lap_time_ms
      return { lap: lap.lap, end: lap.lap_end_ms, dur }
    })
    .sort((a, b) => a.lap - b.lap)

  const durations = rows.map((row) => row.dur).filter((dur) => dur > 0)
  const avgDur =
    durations.length > 0 ? durations.reduce((sum, dur) => sum + dur, 0) / durations.length : null

  return { rows, avgDur }
}

// Race-clock time at which a driver reaches a cumulative progress value
// (completed laps + fraction of the current lap). Interpolates within the lap
// and extrapolates past the driver's last completed lap using their average.
function timeAtProgress(timing: DriverTiming, progress: number): number | null {
  if (timing.rows.length === 0) return null

  const lap = Math.floor(progress)
  const fraction = progress - lap
  const endRow = timing.rows.find((row) => row.lap === lap)

  if (!endRow) {
    const last = timing.rows[timing.rows.length - 1]
    const dur = timing.avgDur ?? 0
    return last.end + (progress - last.lap) * dur
  }

  const nextRow = timing.rows.find((row) => row.lap === lap + 1)
  const dur = nextRow && nextRow.dur > 0 ? nextRow.dur : timing.avgDur ?? 0
  return endRow.end + fraction * dur
}

// Cumulative progress for a driver at an instant, driven by lap timing so it
// never collapses in the zero-padded tail of the final motion chunk. Falls back
// to the raw motion fraction when no lap timing is available.
function progressAtTime(
  timing: DriverTiming,
  timeMs: number,
  totalLaps: number,
  fallbackFraction: number,
): number {
  let completed = 0
  let lastEnd = 0
  for (const row of timing.rows) {
    if (row.end <= timeMs) {
      completed = row.lap
      lastEnd = row.end
    }
  }

  if (totalLaps > 0 && completed >= totalLaps) return totalLaps

  const start = completed === 0 ? 0 : lastEnd
  const nextRow = timing.rows.find((row) => row.lap === completed + 1)
  const dur = nextRow && nextRow.dur > 0 ? nextRow.dur : timing.avgDur
  if (dur === null || dur <= 0) return completed + clamp(fallbackFraction, 0, 1)

  return completed + clamp((timeMs - start) / dur, 0, 1)
}

function tyreInfo(
  currentLap: number,
  laps: readonly Lap[],
  stints: readonly Stint[],
): { compound: string | null; tyreAge: number | null } {
  const stint = stints.find(
    (entry) => entry.lapStart <= currentLap && currentLap <= entry.lapEnd,
  )
  if (stint) {
    return {
      compound: stint.compound,
      tyreAge: stint.tyreAgeAtStart + Math.max(0, currentLap - stint.lapStart),
    }
  }

  const lapRecord =
    laps.find((lap) => lap.lap === currentLap) ??
    [...laps].reverse().find((lap) => lap.lap < currentLap)

  return {
    compound: lapRecord?.compound ?? null,
    tyreAge: lapRecord?.tyre_age ?? null,
  }
}

function pitInfo(
  timeMs: number,
  pitStops: readonly PitStop[],
): { pitCount: number; lastPitLap: number | null; lastPitMs: number | null } {
  let pitCount = 0
  let lastPit: PitStop | null = null

  for (const stop of pitStops) {
    if (stop.time_ms <= timeMs) {
      pitCount += 1
      if (lastPit === null || stop.time_ms >= lastPit.time_ms) lastPit = stop
    }
  }

  return {
    pitCount,
    lastPitLap: lastPit?.lap ?? null,
    lastPitMs: lastPit?.time_ms ?? null,
  }
}

// Build the running order at a single instant. Ordering uses cumulative
// progress (completed laps + position within the current lap) so that, exactly
// at a lap boundary, the order matches the official classification at the line.
export function buildLeaderboard(inputs: LeaderboardInputs): LeaderboardEntry[] {
  const { timeMs, samples, laps, stints, pitStops, gapTable, driverOrder, results } = inputs

  const sampleByDriver = new Map(samples.map((sample) => [sample.driverId, sample]))
  const lapsByDriver = groupByDriver(laps)
  const stintsByDriver = groupByDriver(stints)
  const pitStopsByDriver = groupByDriver(pitStops)
  const timingByDriver = new Map<string, DriverTiming>()
  for (const [driverId, driverLaps] of lapsByDriver) {
    timingByDriver.set(driverId, buildTiming(driverLaps))
  }

  // FastF1's official classification (results) and its lap timing (laps) come
  // from different sources and differ by a small per-driver offset. Calibrate
  // each driver's lap clock so the final gaps match the official result exactly
  // without disturbing the mid-race values.
  const resultByDriver = new Map<string, Result>()
  let winnerTimeMs: number | null = null
  if (results && results.length > 0) {
    for (const result of results) resultByDriver.set(result.driverId, result)
    const winner = results.find((result) => result.position === 1)
    if (winner && winner.time_ms !== null) winnerTimeMs = winner.time_ms
  }

  const finishOffset = (driverId: string): number => {
    if (winnerTimeMs === null) return 0
    const result = resultByDriver.get(driverId)
    if (!result || result.gap_ms === null) return 0
    const timing = timingByDriver.get(driverId)
    const lastEnd = timing?.rows[timing.rows.length - 1]?.end
    if (lastEnd === undefined) return 0
    return winnerTimeMs + result.gap_ms - lastEnd
  }

  // A driver listed in the results with no position, no time and no gap, and
  // with no lap rows at all, never started the race (DNS). Such a car must not
  // inherit a running status from its garage telemetry: the location feed
  // still reports a stationary position that projects to a high track
  // progress, which used to put it provisionally P1.
  const isNonStarter = (driverId: string): boolean => {
    if (laps.length === 0) return false
    const driverLaps = lapsByDriver.get(driverId)
    if (driverLaps && driverLaps.length > 0) return false
    const result = resultByDriver.get(driverId)
    return Boolean(
      result &&
        result.position === null &&
        result.time_ms === null &&
        result.gap_ms === null,
    )
  }

  const totalLaps =
    gapTable?.lapCount ??
    laps.reduce((max, lap) => Math.max(max, lap.lap), 0)

  const ids =
    driverOrder && driverOrder.length > 0
      ? [...driverOrder]
      : samples.map((sample) => sample.driverId)

  const entries: LeaderboardEntry[] = ids.map((driverId) => {
    const sample = sampleByDriver.get(driverId)
    const nonStarter = isNonStarter(driverId)
    const progress = nonStarter ? 0 : sample?.progress ?? 0
    const progressFraction = nonStarter ? 0 : clamp(progress / LAP_PROGRESS_UNITS, 0, 1)
    const driverLaps = lapsByDriver.get(driverId) ?? []
    const timing = timingByDriver.get(driverId)
    const { lapsCompleted, lastLapEndMs } = summarizeLaps(driverLaps, timeMs)
    const currentLap = lapsCompleted + 1
    const tyre = tyreInfo(currentLap, driverLaps, stintsByDriver.get(driverId) ?? [])
    const pit = pitInfo(timeMs, pitStopsByDriver.get(driverId) ?? [])

    // Prefer lap-derived progress: motion progress can collapse to zero in the
    // zero-padded tail of the final chunk, which produced bogus +0.000 gaps.
    const totalProgress =
      timing && timing.rows.length > 0
        ? progressAtTime(timing, timeMs, totalLaps, progressFraction)
        : lapsCompleted + progressFraction

    // DNS cars are outside the running order even though the motion feed may
    // still report status 0 from their garage telemetry.
    const status = nonStarter
      ? DRIVER_STATUS.OUT
      : sample?.status ?? DRIVER_STATUS.OUT

    return {
      driverId,
      position: 0,
      lapsCompleted,
      lap: currentLap,
      progress,
      progressFraction,
      totalProgress,
      status,
      inPit: status === DRIVER_STATUS.PIT,
      compound: tyre.compound,
      tyreAge: tyre.tyreAge,
      pitCount: pit.pitCount,
      lastPitLap: pit.lastPitLap,
      lastPitMs: pit.lastPitMs,
      lastLapEndMs,
      gapMs: null,
      intervalMs: null,
    }
  })

  const orderIndex = new Map(ids.map((driverId, index) => [driverId, index]))

  entries.sort((a, b) => {
    if (b.totalProgress !== a.totalProgress) return b.totalProgress - a.totalProgress

    // Same distance covered: whoever reached the last line first is ahead.
    const aLine = a.lastLapEndMs ?? Number.POSITIVE_INFINITY
    const bLine = b.lastLapEndMs ?? Number.POSITIVE_INFINITY
    if (aLine !== bLine) return aLine - bLine

    return (orderIndex.get(a.driverId) ?? 0) - (orderIndex.get(b.driverId) ?? 0)
  })

  // Gaps from real lap timing whenever we have it: evaluate every driver at the
  // leader's cumulative progress and take the race-clock difference. This keeps
  // working at the finish line (distinct per-driver lap-end times) instead of
  // collapsing to zero. The synthetic gap table is only a fallback.
  // The reference is the first car still running: a retired car can hold a
  // high cumulative progress, but gaps must be measured off the actual leader.
  const leaderEntry = entries.find((entry) => entry.status !== DRIVER_STATUS.OUT)
  const leaderTiming = leaderEntry ? timingByDriver.get(leaderEntry.driverId) : undefined
  const useLapTiming = Boolean(leaderTiming && leaderTiming.rows.length > 0)

  if (useLapTiming && leaderTiming && leaderEntry) {
    const leaderProgress = leaderEntry.totalProgress
    const leaderClock = timeAtProgress(leaderTiming, leaderProgress)
    const leaderOffset = finishOffset(leaderEntry.driverId)

    entries.forEach((entry) => {
      if (entry.status === DRIVER_STATUS.OUT) return
      if (entry === leaderEntry) {
        entry.gapMs = 0
        entry.intervalMs = null
        return
      }

      const timing = timingByDriver.get(entry.driverId)
      if (!timing) return
      const clock = timeAtProgress(timing, leaderProgress)
      if (leaderClock === null || clock === null) return

      // A car behind reaches the leader's position later, so its clock is
      // higher. The per-driver finish offset aligns the end with results.
      const adjusted = clock + finishOffset(entry.driverId) - (leaderClock + leaderOffset)
      entry.gapMs = Math.max(0, adjusted)
    })
  } else if (gapTable && leaderEntry) {
    const clocks = entries.map((entry) => {
      if (entry.status === DRIVER_STATUS.OUT) return null
      const lap = clamp(entry.lap, 1, gapTable.lapCount)
      return raceClockAt(gapTable, entry.driverId, lap, entry.progressFraction)
    })
    const leaderIndex = entries.indexOf(leaderEntry)
    const leaderClock = clocks[leaderIndex] ?? null

    entries.forEach((entry, index) => {
      if (entry.status === DRIVER_STATUS.OUT) return
      const clock = clocks[index]
      if (leaderClock !== null && clock !== null) {
        entry.gapMs = Math.max(0, leaderClock - clock)
      }
    })
  }

  // The interval to the car ahead is the live gap "between drivers": each
  // running car is measured against the nearest running car in front, so a
  // retired car never breaks the chain. Recomputed every frame by the caller,
  // this is what makes the leaderboard gaps update in real time.
  let ahead: LeaderboardEntry | null = null
  let runningPosition = 0
  for (const entry of entries) {
    if (entry.status === DRIVER_STATUS.OUT) {
      entry.position = 0
      entry.gapMs = null
      entry.intervalMs = null
      continue
    }
    entry.position = ++runningPosition
    if (ahead !== null && ahead.gapMs !== null && entry.gapMs !== null) {
      // The running order is authoritative, so the gap to the leader can never
      // decrease down the field. Clamping absorbs the small differences between
      // each driver's extrapolated lap clock and keeps intervals non-negative.
      entry.gapMs = Math.max(entry.gapMs, ahead.gapMs)
      entry.intervalMs = entry.gapMs - ahead.gapMs
    } else {
      entry.intervalMs = null
    }
    ahead = entry
  }

  return entries
}

export function compoundLetter(compound: string | null): string {
  if (!compound) return '–'
  const key = compound.toUpperCase()
  if (key.startsWith('SOFT')) return 'S'
  if (key.startsWith('MEDIUM')) return 'M'
  if (key.startsWith('HARD')) return 'H'
  if (key.startsWith('INTER')) return 'I'
  if (key.startsWith('WET')) return 'W'
  return key.charAt(0)
}

export function compoundTone(compound: string | null): BadgeTone {
  const key = (compound ?? '').toUpperCase()
  if (key.startsWith('SOFT')) return 'soft'
  if (key.startsWith('MEDIUM')) return 'medium'
  if (key.startsWith('HARD')) return 'hard'
  if (key.startsWith('INTER')) return 'intermediate'
  if (key.startsWith('WET')) return 'wet'
  return 'neutral'
}

// Format a gap/interval as "+1.234" seconds. An unknown gap shows an em dash.
export function formatGap(ms: number | null): string {
  if (ms === null) return '—'
  return `+${(ms / 1000).toFixed(3)}`
}
