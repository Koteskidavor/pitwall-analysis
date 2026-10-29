import { decodeGapsChunk } from '@pitwall/shared'

// gaps.bin stores, per driver per lap per checkpoint, the crossing time (ms).
// 0xFFFFFFFF marks a checkpoint the driver never reached (retired / lapped away).
export const GAP_NOT_CROSSED = 0xffffffff
export const DEFAULT_CHECKPOINTS_PER_LAP = 100

export interface GapTable {
  driverOrder: readonly string[]
  lapCount: number
  checkpointsPerLap: number
  crossingTimes: Uint32Array
}

// Decode the raw gaps.bin payload into an indexed table. The decoder enforces
// the expected byte length, so a truncated download fails loudly here.
export function buildGapTable(
  buffer: ArrayBuffer,
  driverOrder: readonly string[],
  lapCount: number,
  checkpointsPerLap: number = DEFAULT_CHECKPOINTS_PER_LAP,
): GapTable {
  const { crossingTimes } = decodeGapsChunk(
    buffer,
    driverOrder.length,
    lapCount,
    checkpointsPerLap,
  )
  return {
    driverOrder: [...driverOrder],
    lapCount,
    checkpointsPerLap,
    crossingTimes,
  }
}

// Map a lap-relative progress fraction (0..1) onto its nearest checkpoint.
export function checkpointIndex(
  progressFraction: number,
  checkpointsPerLap: number = DEFAULT_CHECKPOINTS_PER_LAP,
): number {
  const clamped = Math.min(1, Math.max(0, progressFraction))
  return Math.min(checkpointsPerLap - 1, Math.floor(clamped * (checkpointsPerLap - 1)))
}

// Crossing time (ms) for a driver on a 1-based lap at a 0-based checkpoint, or
// null when the driver never crossed it.
export function crossingTimeAt(
  table: GapTable,
  driverId: string,
  lap: number,
  checkpoint: number,
): number | null {
  const driverIndex = table.driverOrder.indexOf(driverId)
  if (driverIndex < 0) return null
  if (lap < 1 || lap > table.lapCount) return null
  if (checkpoint < 0 || checkpoint >= table.checkpointsPerLap) return null

  const index =
    driverIndex * table.lapCount * table.checkpointsPerLap +
    (lap - 1) * table.checkpointsPerLap +
    checkpoint
  const value = table.crossingTimes[index]
  return value === GAP_NOT_CROSSED ? null : value
}

// The race-clock reading for a driver at their current lap/position, derived
// from the gap table. The position is interpolated between the two surrounding
// checkpoint crossing times so the clock is continuous within a lap instead of
// snapping down to the previous checkpoint. Null when neither bounding
// checkpoint has a usable crossing time.
export function raceClockAt(
  table: GapTable,
  driverId: string,
  lap: number,
  progressFraction: number,
): number | null {
  const last = table.checkpointsPerLap - 1
  if (last <= 0) return crossingTimeAt(table, driverId, lap, 0)

  const clamped = Math.min(1, Math.max(0, progressFraction))
  const position = clamped * last
  const lower = Math.floor(position)
  const upper = Math.min(last, lower + 1)
  const lowerTime = crossingTimeAt(table, driverId, lap, lower)
  const upperTime = crossingTimeAt(table, driverId, lap, upper)

  if (lowerTime === null) return upperTime
  if (upperTime === null || lower === upper) return lowerTime

  return lowerTime + (upperTime - lowerTime) * (position - lower)
}
