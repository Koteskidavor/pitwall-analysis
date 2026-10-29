import { describe, it, expect } from 'vitest'
import type { Lap, PitStop, Stint } from '@pitwall/shared'
import { DRIVER_STATUS, type MotionSample } from '../engine'
import {
  buildGapTable,
  checkpointIndex,
  crossingTimeAt,
  raceClockAt,
  type GapTable,
} from '../features/leaderboard/gaps'
import {
  buildLeaderboard,
  compoundLetter,
  compoundTone,
  formatGap,
} from '../features/leaderboard/leaderboard'

const DRIVER_ORDER = ['VER', 'HAM', 'PER']

function sample(
  driverId: string,
  progress: number,
  status: number = DRIVER_STATUS.RUNNING,
): MotionSample {
  return { driverId, progress, x: 0, y: 0, speed: 0, status }
}

function makeLap(overrides: Partial<Lap> & Pick<Lap, 'driverId' | 'lap'>): Lap {
  const lap_time_ms = overrides.lap_time_ms ?? 90000
  const lap_end_ms = overrides.lap_end_ms ?? 0
  return {
    lap_time_ms,
    lap_start_ms: lap_end_ms > 0 ? lap_end_ms - lap_time_ms : 0,
    lap_end_ms,
    s1_ms: null,
    s2_ms: null,
    s3_ms: null,
    position: null,
    compound: 'MEDIUM',
    tyre_age: 0,
    is_accurate: true,
    is_pit_in: false,
    is_pit_out: false,
    ...overrides,
  }
}

// Two completed laps per driver, staggered across the line, with the official
// classification recorded on each lap row.
const RACE_LAPS: Lap[] = [
  makeLap({ driverId: 'VER', lap: 1, lap_end_ms: 90000, position: 1 }),
  makeLap({ driverId: 'HAM', lap: 1, lap_end_ms: 91000, position: 2 }),
  makeLap({ driverId: 'PER', lap: 1, lap_end_ms: 92000, position: 3 }),
  makeLap({ driverId: 'VER', lap: 2, lap_end_ms: 180000, position: 1 }),
  makeLap({ driverId: 'HAM', lap: 2, lap_end_ms: 182000, position: 2 }),
  makeLap({ driverId: 'PER', lap: 2, lap_end_ms: 184000, position: 3 }),
]

function encodeGapBuffer(
  driverOrder: readonly string[],
  lapCount: number,
  checkpointsPerLap: number,
  values: Array<{ driverId: string; lap: number; checkpoint: number; timeMs: number }>,
): ArrayBuffer {
  const buffer = new ArrayBuffer(driverOrder.length * lapCount * checkpointsPerLap * 4)
  const view = new DataView(buffer)
  for (let i = 0; i < driverOrder.length * lapCount * checkpointsPerLap; i++) {
    view.setUint32(i * 4, 0xffffffff, true)
  }
  for (const value of values) {
    const driverIndex = driverOrder.indexOf(value.driverId)
    const index =
      driverIndex * lapCount * checkpointsPerLap +
      (value.lap - 1) * checkpointsPerLap +
      value.checkpoint
    view.setUint32(index * 4, value.timeMs, true)
  }
  return buffer
}

describe('leaderboard', () => {
  describe('gaps.bin decoding', () => {
    it('decodes the crossing-time table and reads checkpoints back', () => {
      const buffer = encodeGapBuffer(DRIVER_ORDER, 2, 100, [
        { driverId: 'HAM', lap: 2, checkpoint: 14, timeMs: 99500 },
      ])
      const table = buildGapTable(buffer, DRIVER_ORDER, 2, 100)

      expect(table.crossingTimes).toHaveLength(600)
      expect(crossingTimeAt(table, 'HAM', 2, 14)).toBe(99500)
      // A checkpoint with no crossing decodes to null, not 0xFFFFFFFF.
      expect(crossingTimeAt(table, 'HAM', 2, 50)).toBeNull()
    })

    it('maps a progress fraction onto the correct checkpoint', () => {
      expect(checkpointIndex(0, 100)).toBe(0)
      expect(checkpointIndex(0.3, 100)).toBe(29)
      expect(checkpointIndex(1, 100)).toBe(99)
      expect(checkpointIndex(2, 100)).toBe(99)
    })

    it('rejects a payload whose size does not match the manifest', () => {
      const tooSmall = new ArrayBuffer(16)
      expect(() => buildGapTable(tooSmall, DRIVER_ORDER, 2, 100)).toThrow()
    })
  })

  describe('ordering', () => {
    it('orders by cumulative progress when cars are on the same lap', () => {
      const entries = buildLeaderboard({
        timeMs: 30000,
        samples: [sample('VER', 60), sample('HAM', 40), sample('PER', 20)],
        laps: RACE_LAPS,
        stints: [],
        pitStops: [],
      })

      expect(entries.map((entry) => entry.driverId)).toEqual(['VER', 'HAM', 'PER'])
      expect(entries.map((entry) => entry.position)).toEqual([1, 2, 3])
    })

    it('ranks a car that has completed more laps ahead of one still on the old lap', () => {
      const entries = buildLeaderboard({
        timeMs: 91999,
        samples: [sample('VER', 30), sample('HAM', 15), sample('PER', 99)],
        laps: RACE_LAPS,
        stints: [],
        pitStops: [],
      })

      // PER is near the end of lap 1 (0.99) but VER and HAM have already
      // started lap 2, so they stay ahead.
      expect(entries.map((entry) => entry.driverId)).toEqual(['VER', 'HAM', 'PER'])
      expect(entries[2].lapsCompleted).toBe(0)
    })

    it('matches the official lap-end positions at the line for every lap', () => {
      for (let lap = 1; lap <= 2; lap += 1) {
        const boundary = Math.max(
          ...RACE_LAPS.filter((row) => row.lap === lap).map((row) => row.lap_end_ms),
        )
        const official = RACE_LAPS.filter((row) => row.lap === lap)
          .slice()
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((row) => row.driverId)

        const entries = buildLeaderboard({
          timeMs: boundary,
          samples: [sample('VER', 30), sample('HAM', 15), sample('PER', 0)],
          laps: RACE_LAPS,
          stints: [],
          pitStops: [],
          driverOrder: DRIVER_ORDER,
        })

        expect(entries.map((entry) => entry.driverId)).toEqual(official)
        expect(entries.map((entry) => entry.position)).toEqual([1, 2, 3])
      }
    })
  })

  describe('tyre and pit info', () => {
    const stints: Stint[] = [
      { driverId: 'VER', lapStart: 1, lapEnd: 1, compound: 'SOFT', tyreAgeAtStart: 1 },
      { driverId: 'VER', lapStart: 2, lapEnd: 50, compound: 'HARD', tyreAgeAtStart: 1 },
    ]
    const pitStops: PitStop[] = [
      { driverId: 'VER', lap: 1, time_ms: 90000, duration_ms: 2500 },
      { driverId: 'VER', lap: 2, time_ms: 200000, duration_ms: 2300 },
    ]

    it('reads compound and tyre age from the current stint', () => {
      const [entry] = buildLeaderboard({
        timeMs: 150000,
        samples: [sample('VER', 20)],
        laps: RACE_LAPS,
        stints,
        pitStops,
        driverOrder: ['VER'],
      })

      expect(entry.lap).toBe(2)
      expect(entry.compound).toBe('HARD')
      // Stint started on lap 2, so on lap 2 the tyre is one lap old.
      expect(entry.tyreAge).toBe(1)
    })

    it('counts only pit stops that have already happened', () => {
      const before = buildLeaderboard({
        timeMs: 100000,
        samples: [sample('VER', 20)],
        laps: RACE_LAPS,
        stints,
        pitStops,
        driverOrder: ['VER'],
      })[0]
      expect(before.pitCount).toBe(1)
      expect(before.lastPitLap).toBe(1)

      const after = buildLeaderboard({
        timeMs: 250000,
        samples: [sample('VER', 5)],
        laps: RACE_LAPS,
        stints,
        pitStops,
        driverOrder: ['VER'],
      })[0]
      expect(after.pitCount).toBe(2)
      expect(after.lastPitLap).toBe(2)
    })

    it('flags a car in the pit lane from its motion status', () => {
      const [entry] = buildLeaderboard({
        timeMs: 100000,
        samples: [sample('VER', 20, DRIVER_STATUS.PIT)],
        laps: RACE_LAPS,
        stints,
        pitStops,
        driverOrder: ['VER'],
      })
      expect(entry.inPit).toBe(true)
    })
  })

  describe('gaps from lap timing', () => {
    it('derives gaps and intervals to the car ahead from real lap crossings', () => {
      const entries = buildLeaderboard({
        timeMs: 175000,
        samples: [sample('VER', 30), sample('HAM', 15), sample('PER', 2)],
        laps: RACE_LAPS,
        stints: [],
        pitStops: [],
        driverOrder: DRIVER_ORDER,
      })

      expect(entries.map((entry) => entry.driverId)).toEqual(['VER', 'HAM', 'PER'])
      expect(entries[0].gapMs).toBe(0)
      expect(entries[0].intervalMs).toBeNull()
      expect(entries[1].gapMs).toBe(1000)
      expect(entries[1].intervalMs).toBe(1000)
      expect(entries[2].gapMs).toBe(2000)
      expect(entries[2].intervalMs).toBe(1000)
    })

    it('keeps real gaps at the finish instead of collapsing to zero', () => {
      // Motion progress is zero here, mimicking the zero-padded final chunk.
      const entries = buildLeaderboard({
        timeMs: 184000,
        samples: [sample('VER', 0), sample('HAM', 0), sample('PER', 0)],
        laps: RACE_LAPS,
        stints: [],
        pitStops: [],
        driverOrder: DRIVER_ORDER,
      })

      expect(entries.map((entry) => entry.driverId)).toEqual(['VER', 'HAM', 'PER'])
      expect(entries[0].gapMs).toBe(0)
      expect(entries[1].gapMs).toBe(2000)
      expect(entries[2].gapMs).toBe(4000)
      expect(entries[2].gapMs).not.toBe(0)
    })

    it('measures each car against the nearest running car ahead', () => {
      const lapsWithRetirement: Lap[] = [
        ...RACE_LAPS,
        makeLap({ driverId: 'SAI', lap: 1, lap_end_ms: 93000, position: 4 }),
        makeLap({ driverId: 'SAI', lap: 2, lap_end_ms: 186000, position: 4 }),
      ]

      const entries = buildLeaderboard({
        timeMs: 175000,
        samples: [
          sample('VER', 30),
          sample('HAM', 15),
          sample('PER', 2),
          sample('SAI', 0, DRIVER_STATUS.OUT),
        ],
        laps: lapsWithRetirement,
        stints: [],
        pitStops: [],
        driverOrder: [...DRIVER_ORDER, 'SAI'],
      })

      // The retired car is dropped from the running order, and PER's interval
      // stays measured against HAM rather than the car that is no longer there.
      expect(entries.map((entry) => entry.driverId)).toEqual(['VER', 'HAM', 'PER', 'SAI'])
      expect(entries[1].intervalMs).toBe(1000)
      expect(entries[2].intervalMs).toBe(1000)
      expect(entries[3].gapMs).toBeNull()
      expect(entries[3].intervalMs).toBeNull()
    })

    it('calibrates final gaps to the official classification', () => {
      const entries = buildLeaderboard({
        timeMs: 184000,
        samples: [sample('VER', 0), sample('HAM', 0), sample('PER', 0)],
        laps: RACE_LAPS,
        stints: [],
        pitStops: [],
        driverOrder: DRIVER_ORDER,
        results: [
          { driverId: 'VER', position: 1, time_ms: 179500, gap_ms: 0, points: 25 },
          { driverId: 'HAM', position: 2, time_ms: 3000, gap_ms: 3000, points: 18 },
          { driverId: 'PER', position: 3, time_ms: 5500, gap_ms: 5500, points: 15 },
        ],
      })

      expect(entries[1].gapMs).toBe(3000)
      expect(entries[2].gapMs).toBe(5500)
    })
  })

  describe('gap table fallback', () => {
    it('derives gaps and intervals to the car ahead when no lap timing exists', () => {
      const buffer = encodeGapBuffer(DRIVER_ORDER, 1, 100, [
        { driverId: 'VER', lap: 1, checkpoint: checkpointIndex(0.3, 100), timeMs: 100000 },
        { driverId: 'HAM', lap: 1, checkpoint: checkpointIndex(0.15, 100), timeMs: 99500 },
        { driverId: 'PER', lap: 1, checkpoint: checkpointIndex(0.02, 100), timeMs: 90000 },
      ])
      const gapTable: GapTable = buildGapTable(buffer, DRIVER_ORDER, 1, 100)

      const entries = buildLeaderboard({
        timeMs: 175000,
        samples: [sample('VER', 30), sample('HAM', 15), sample('PER', 2)],
        laps: [],
        stints: [],
        pitStops: [],
        gapTable,
        driverOrder: DRIVER_ORDER,
      })

      expect(entries.map((entry) => entry.driverId)).toEqual(['VER', 'HAM', 'PER'])
      expect(entries[0].gapMs).toBe(0)
      expect(entries[0].intervalMs).toBeNull()
      expect(entries[1].gapMs).toBe(500)
      expect(entries[1].intervalMs).toBe(500)
      expect(entries[2].gapMs).toBe(10000)
      expect(entries[2].intervalMs).toBe(9500)

      // The clock reader is the primitive the gaps above are built from.
      expect(raceClockAt(gapTable, 'HAM', 1, 0.15)).toBe(99500)
    })

    it('interpolates the race clock between adjacent checkpoints', () => {
      const buffer = encodeGapBuffer(DRIVER_ORDER, 1, 100, [
        { driverId: 'VER', lap: 1, checkpoint: 14, timeMs: 10000 },
        { driverId: 'VER', lap: 1, checkpoint: 15, timeMs: 11000 },
      ])
      const gapTable = buildGapTable(buffer, DRIVER_ORDER, 1, 100)

      // 0.15 lands 85% of the way from checkpoint 14 to 15.
      expect(raceClockAt(gapTable, 'VER', 1, 0.15)).toBeCloseTo(10850, 6)
    })

    it('leaves gaps null when a checkpoint was never crossed', () => {
      const buffer = encodeGapBuffer(DRIVER_ORDER, 1, 100, [
        { driverId: 'VER', lap: 1, checkpoint: checkpointIndex(0.3, 100), timeMs: 100000 },
      ])
      const gapTable = buildGapTable(buffer, DRIVER_ORDER, 1, 100)

      const entries = buildLeaderboard({
        timeMs: 175000,
        samples: [sample('VER', 30), sample('HAM', 15)],
        laps: [],
        stints: [],
        pitStops: [],
        gapTable,
        driverOrder: ['VER', 'HAM'],
      })

      expect(entries[0].gapMs).toBe(0)
      expect(entries[1].gapMs).toBeNull()
    })
  })

  describe('formatting helpers', () => {
    it('labels compounds and their tones', () => {
      expect(compoundLetter('SOFT')).toBe('S')
      expect(compoundLetter('MEDIUM')).toBe('M')
      expect(compoundLetter('HARD')).toBe('H')
      expect(compoundLetter(null)).toBe('–')
      expect(compoundTone('SOFT')).toBe('soft')
      expect(compoundTone('WET')).toBe('wet')
      expect(compoundTone(null)).toBe('neutral')
    })

    it('formats gaps as signed seconds', () => {
      expect(formatGap(null)).toBe('—')
      expect(formatGap(0)).toBe('+0.000')
      expect(formatGap(1234)).toBe('+1.234')
    })
  })
})
