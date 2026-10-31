import Database from 'better-sqlite3'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteStorage } from '../src/models/sqlite-storage'
import { createServer } from '../src/server'
import {
  TEST_SESSION_ID,
  createApiTestFixture,
  type ApiTestFixture,
} from './fixture'

const INVALID_SESSION_ID = '2099_2_Race'
const CORRUPT_SESSION_ID = '2099_3_Race'

describe('API resilience', () => {
  let fastify: ReturnType<typeof createServer>
  let fixture: ApiTestFixture

  beforeEach(async () => {
    fixture = createApiTestFixture()
    writeInvalidSession(fixture.dataRoot)
    writeCorruptSession(fixture.dataRoot)

    fastify = createServer({ dataRoot: fixture.dataRoot })
    fastify.log.level = 'silent'
    await fastify.ready()
  })

  afterEach(async () => {
    await fastify.close()
    fixture.cleanup()
  })

  it('skips invalid rows and unreadable databases when listing sessions', async () => {
    const response = await fastify.inject({ method: 'GET', url: '/api/sessions' })

    expect(response.statusCode).toBe(200)
    const sessions = JSON.parse(response.payload) as Array<{ id: string }>
    expect(sessions.map((session) => session.id)).toEqual([TEST_SESSION_ID])
  })

  it('reports a corrupt session as a server error instead of a missing session', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: `/api/sessions/${CORRUPT_SESSION_ID}`,
    })

    expect(response.statusCode).toBe(500)
  })

  it('logs rows and sessions that cannot be read', async () => {
    const warnings: unknown[][] = []
    const storage = new SqliteStorage(fixture.dataRoot, {
      warn: (...args) => warnings.push(args),
    })

    try {
      const sessions = await storage.getSessions()
      expect(sessions.map((session) => session.id)).toEqual([TEST_SESSION_ID])
    } finally {
      storage.close()
    }

    expect(warnings.length).toBeGreaterThanOrEqual(2)
  })
})

function writeInvalidSession(dataRoot: string): void {
  const sessionDir = join(dataRoot, 'sessions', INVALID_SESSION_ID)
  mkdirSync(sessionDir, { recursive: true })

  const db = new Database(join(sessionDir, 'data.sqlite'))
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      year INTEGER NOT NULL,
      round INTEGER NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      track TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      status TEXT NOT NULL,
      processed_at TEXT,
      session_date TEXT
    );
  `)
  db.prepare(`
    INSERT INTO sessions (
      id, year, round, type, name, track, schema_version, status,
      processed_at, session_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    INVALID_SESSION_ID,
    2099,
    2,
    'Race',
    'Invalid Session',
    'Fixture Circuit',
    '1.0.0',
    'not-a-valid-status',
    null,
    null,
  )
  db.close()
}

function writeCorruptSession(dataRoot: string): void {
  const sessionDir = join(dataRoot, 'sessions', CORRUPT_SESSION_ID)
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(join(sessionDir, 'data.sqlite'), 'this is not a sqlite database')
}
