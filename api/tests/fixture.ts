import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BINARY_LAYOUT,
  GAPS_LAYOUT,
  type Driver,
  type Event,
  type Lap,
  type Manifest,
  type PitStop,
  type Result,
  type Session,
  type Stint,
  type Track,
} from '../../shared/src/schemas'

// A small, self-contained data tree. Tests build this in a temporary directory
// instead of reading the gitignored data/ folder, so they behave the same on a
// fresh clone and on a developer machine with real sessions ingested.
export const TEST_SESSION_ID = '2099_1_Race'
export const TEST_DRIVER_ID = 'TST'
export const TEST_OTHER_DRIVER_ID = 'TS2'

export const TEST_SESSION: Session = {
  id: TEST_SESSION_ID,
  year: 2099,
  round: 1,
  type: 'Race',
  name: 'Fixture Grand Prix',
  track: 'Fixture Circuit',
  schema_version: '1.0.0',
  status: 'ready',
  processed_at: '2099-03-01T12:00:00.000Z',
  session_date: '2099-03-02T10:00:00.000Z',
}

export const TEST_DRIVERS: Driver[] = [
  {
    id: TEST_DRIVER_ID,
    code: TEST_DRIVER_ID,
    name: 'Fixture Driver One',
    nationality: 'Testland',
  },
  {
    id: TEST_OTHER_DRIVER_ID,
    code: TEST_OTHER_DRIVER_ID,
    name: 'Fixture Driver Two',
    nationality: 'Testland',
  },
]

export const TEST_RESULTS: Result[] = [
  {
    driverId: TEST_DRIVER_ID,
    position: 1,
    time_ms: 5_000_000,
    gap_ms: 0,
    grid_position: 1,
    points: 25,
  },
  {
    driverId: TEST_OTHER_DRIVER_ID,
    position: 2,
    time_ms: 5_005_000,
    gap_ms: 5_000,
    grid_position: 2,
    points: 18,
  },
]

export const TEST_LAPS: Lap[] = [
  {
    driverId: TEST_DRIVER_ID,
    lap: 1,
    lap_time_ms: 90_000,
    lap_start_ms: 0,
    lap_end_ms: 90_000,
    s1_ms: 30_000,
    s2_ms: 30_000,
    s3_ms: 30_000,
    position: 1,
    compound: 'SOFT',
    tyre_age: 1,
    is_accurate: true,
    is_pit_in: false,
    is_pit_out: false,
  },
  {
    driverId: TEST_DRIVER_ID,
    lap: 2,
    lap_time_ms: 91_000,
    lap_start_ms: 90_000,
    lap_end_ms: 181_000,
    s1_ms: 30_500,
    s2_ms: 30_000,
    s3_ms: 30_500,
    position: 1,
    compound: 'SOFT',
    tyre_age: 2,
    is_accurate: true,
    is_pit_in: false,
    is_pit_out: false,
  },
  {
    driverId: TEST_OTHER_DRIVER_ID,
    lap: 1,
    lap_time_ms: 91_500,
    lap_start_ms: 0,
    lap_end_ms: 91_500,
    s1_ms: 30_500,
    s2_ms: 30_500,
    s3_ms: 30_500,
    position: 2,
    compound: 'MEDIUM',
    tyre_age: 1,
    is_accurate: true,
    is_pit_in: false,
    is_pit_out: false,
  },
  {
    driverId: TEST_OTHER_DRIVER_ID,
    lap: 2,
    lap_time_ms: 92_000,
    lap_start_ms: 91_500,
    lap_end_ms: 183_500,
    s1_ms: 31_000,
    s2_ms: 30_500,
    s3_ms: 30_500,
    position: 2,
    compound: 'MEDIUM',
    tyre_age: 2,
    is_accurate: true,
    is_pit_in: false,
    is_pit_out: false,
  },
]

export const TEST_STINTS: Stint[] = [
  {
    driverId: TEST_DRIVER_ID,
    lapStart: 1,
    lapEnd: 2,
    compound: 'SOFT',
    tyreAgeAtStart: 1,
  },
  {
    driverId: TEST_OTHER_DRIVER_ID,
    lapStart: 1,
    lapEnd: 2,
    compound: 'MEDIUM',
    tyreAgeAtStart: 1,
  },
]

export const TEST_PIT_STOPS: PitStop[] = [
  {
    driverId: TEST_DRIVER_ID,
    lap: 2,
    time_ms: 95_000,
    duration_ms: 23_000,
  },
  {
    driverId: TEST_OTHER_DRIVER_ID,
    lap: 2,
    time_ms: 100_000,
    duration_ms: 24_500,
  },
]

export const TEST_EVENTS: Event[] = [
  {
    id: 'rcm_0',
    timestamp_ms: 1_000,
    type: 'Flag',
    driverId: TEST_DRIVER_ID,
    message: 'Green flag',
  },
  {
    id: 'ts_1',
    timestamp_ms: 2_000,
    type: 'track_status',
    driverId: null,
    message: 'Track status: 1',
  },
  {
    id: 'rcm_2',
    timestamp_ms: 3_000,
    type: 'Flag',
    driverId: TEST_OTHER_DRIVER_ID,
    message: 'Yellow flag',
  },
]

export const TEST_MANIFEST: Manifest = {
  schemaVersion: '1.0.0',
  sampleHz: 5,
  chunkSeconds: 60,
  driverOrder: [TEST_DRIVER_ID, TEST_OTHER_DRIVER_ID],
  chunkCount: 1,
  lapCount: 2,
  trackLengthM: 1_000,
  durationMs: 181_000,
  availableLayers: ['motion', 'gaps'],
}

export const TEST_TRACK: Track = {
  outline: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ],
  sector1: {
    outer: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    inner: null,
  },
  sector2: {
    outer: [
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ],
    inner: null,
  },
  sector3: {
    outer: [
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ],
    inner: null,
  },
  bounds: { x: 100, y: 100 },
}

const MOTION_CHUNK_BYTES =
  TEST_MANIFEST.driverOrder.length *
  TEST_MANIFEST.sampleHz *
  TEST_MANIFEST.chunkSeconds *
  BINARY_LAYOUT.totalBytesPerStep

const GAPS_BYTES =
  TEST_MANIFEST.driverOrder.length *
  (TEST_MANIFEST.lapCount ?? 0) *
  GAPS_LAYOUT.checkpointsPerLap *
  GAPS_LAYOUT.entrySize

export const TEST_MOTION_CHUNK = patternedBuffer(MOTION_CHUNK_BYTES, 7)
export const TEST_GAPS = patternedBuffer(GAPS_BYTES, 11)

export interface ApiTestFixture {
  dataRoot: string
  cleanup: () => void
}

export function createApiTestFixture(): ApiTestFixture {
  const dataRoot = mkdtempSync(join(tmpdir(), 'pitwall-api-test-'))
  const sessionDir = join(dataRoot, 'sessions', TEST_SESSION_ID)
  mkdirSync(join(sessionDir, 'motion'), { recursive: true })

  writeDatabase(join(sessionDir, 'data.sqlite'))
  writeFileSync(
    join(sessionDir, 'manifest.json'),
    JSON.stringify(TEST_MANIFEST, null, 2),
  )
  writeFileSync(
    join(sessionDir, 'track.json'),
    JSON.stringify(TEST_TRACK, null, 2),
  )
  writeFileSync(join(sessionDir, 'motion', '000.bin'), TEST_MOTION_CHUNK)
  writeFileSync(join(sessionDir, 'gaps.bin'), TEST_GAPS)

  return {
    dataRoot,
    cleanup: () => rmSync(dataRoot, { recursive: true, force: true }),
  }
}

function patternedBuffer(size: number, seed: number): Buffer {
  const buffer = Buffer.alloc(size)
  for (let index = 0; index < size; index += 1) {
    buffer[index] = (index * 31 + seed) % 256
  }
  return buffer
}

function writeDatabase(path: string): void {
  const db = new Database(path)

  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      year INTEGER NOT NULL,
      round INTEGER NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      track TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ready', 'failed')),
      processed_at TEXT,
      session_date TEXT
    );

    CREATE TABLE drivers (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      nationality TEXT
    );

    CREATE TABLE laps (
      lap_time_ms INTEGER NOT NULL,
      lap_start_ms INTEGER NOT NULL,
      lap_end_ms INTEGER NOT NULL,
      s1_ms INTEGER,
      s2_ms INTEGER,
      s3_ms INTEGER,
      position INTEGER,
      compound TEXT,
      tyre_age INTEGER,
      is_accurate INTEGER NOT NULL CHECK(is_accurate IN (0, 1)),
      is_pit_in INTEGER NOT NULL CHECK(is_pit_in IN (0, 1)),
      is_pit_out INTEGER NOT NULL CHECK(is_pit_out IN (0, 1)),
      driver_id TEXT NOT NULL,
      lap INTEGER NOT NULL,
      PRIMARY KEY (driver_id, lap)
    );

    CREATE TABLE stints (
      driver_id TEXT NOT NULL,
      lapStart INTEGER NOT NULL,
      lapEnd INTEGER NOT NULL,
      compound TEXT,
      tyreAgeAtStart INTEGER NOT NULL,
      PRIMARY KEY (driver_id, lapStart)
    );

    CREATE TABLE pit_stops (
      driver_id TEXT NOT NULL,
      lap INTEGER NOT NULL,
      time_ms INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0),
      PRIMARY KEY (driver_id, lap)
    );

    CREATE TABLE events (
      id TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      type TEXT NOT NULL,
      driver_id TEXT,
      message TEXT
    );

    CREATE TABLE results (
      driver_id TEXT NOT NULL,
      position INTEGER,
      grid_position INTEGER,
      time_ms INTEGER,
      gap_ms INTEGER,
      points INTEGER DEFAULT 0,
      FOREIGN KEY (driver_id) REFERENCES drivers(id)
    );

    PRAGMA user_version = 1;
  `)

  db.prepare(`
    INSERT INTO sessions (
      id, year, round, type, name, track, schema_version, status,
      processed_at, session_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    TEST_SESSION.id,
    TEST_SESSION.year,
    TEST_SESSION.round,
    TEST_SESSION.type,
    TEST_SESSION.name,
    TEST_SESSION.track,
    TEST_SESSION.schema_version,
    TEST_SESSION.status,
    TEST_SESSION.processed_at,
    TEST_SESSION.session_date,
  )

  const insertDriver = db.prepare(`
    INSERT INTO drivers (id, code, name, nationality) VALUES (?, ?, ?, ?)
  `)
  for (const driver of TEST_DRIVERS) {
    insertDriver.run(driver.id, driver.code, driver.name, driver.nationality)
  }

  const insertLap = db.prepare(`
    INSERT INTO laps (
      lap_time_ms, lap_start_ms, lap_end_ms, s1_ms, s2_ms, s3_ms,
      position, compound, tyre_age, is_accurate, is_pit_in, is_pit_out,
      driver_id, lap
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const lap of TEST_LAPS) {
    insertLap.run(
      lap.lap_time_ms,
      lap.lap_start_ms,
      lap.lap_end_ms,
      lap.s1_ms,
      lap.s2_ms,
      lap.s3_ms,
      lap.position,
      lap.compound,
      lap.tyre_age,
      lap.is_accurate ? 1 : 0,
      lap.is_pit_in ? 1 : 0,
      lap.is_pit_out ? 1 : 0,
      lap.driverId,
      lap.lap,
    )
  }

  const insertStint = db.prepare(`
    INSERT INTO stints (
      driver_id, lapStart, lapEnd, compound, tyreAgeAtStart
    ) VALUES (?, ?, ?, ?, ?)
  `)
  for (const stint of TEST_STINTS) {
    insertStint.run(
      stint.driverId,
      stint.lapStart,
      stint.lapEnd,
      stint.compound,
      stint.tyreAgeAtStart,
    )
  }

  const insertPitStop = db.prepare(`
    INSERT INTO pit_stops (driver_id, lap, time_ms, duration_ms)
    VALUES (?, ?, ?, ?)
  `)
  for (const pitStop of TEST_PIT_STOPS) {
    insertPitStop.run(
      pitStop.driverId,
      pitStop.lap,
      pitStop.time_ms,
      pitStop.duration_ms,
    )
  }

  const insertEvent = db.prepare(`
    INSERT INTO events (id, timestamp_ms, type, driver_id, message)
    VALUES (?, ?, ?, ?, ?)
  `)
  for (const event of TEST_EVENTS) {
    insertEvent.run(
      event.id,
      event.timestamp_ms,
      event.type,
      event.driverId,
      event.message,
    )
  }

  const insertResult = db.prepare(`
    INSERT INTO results (
      driver_id, position, grid_position, time_ms, gap_ms, points
    ) VALUES (?, ?, ?, ?, ?, ?)
  `)
  for (const result of TEST_RESULTS) {
    insertResult.run(
      result.driverId,
      result.position,
      result.grid_position,
      result.time_ms,
      result.gap_ms,
      result.points,
    )
  }

  db.close()
}
