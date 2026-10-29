import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  driverSchema,
  eventSchema,
  lapSchema,
  manifestSchema,
  pitStopSchema,
  resultSchema,
  sessionSchema,
  stintSchema,
  trackSchema,
  type Driver,
  type Event,
  type Lap,
  type PitStop,
  type Result,
  type Stint,
} from '../../shared/src/schemas'
import { createServer } from '../src/server'
import {
  TEST_DRIVER_ID,
  TEST_DRIVERS,
  TEST_EVENTS,
  TEST_GAPS,
  TEST_LAPS,
  TEST_MANIFEST,
  TEST_MOTION_CHUNK,
  TEST_OTHER_DRIVER_ID,
  TEST_PIT_STOPS,
  TEST_RESULTS,
  TEST_SESSION,
  TEST_SESSION_ID,
  TEST_STINTS,
  TEST_TRACK,
  createApiTestFixture,
} from './fixture'

describe('API', () => {
  let fastify: ReturnType<typeof createServer>
  let fixture: ReturnType<typeof createApiTestFixture>

  beforeAll(async () => {
    fixture = createApiTestFixture()
    fastify = createServer({ dataRoot: fixture.dataRoot })
    fastify.log.level = 'silent'
    await fastify.ready()
  })

  afterAll(async () => {
    await fastify.close()
    fixture.cleanup()
  })

  async function get(url: string, headers?: Record<string, string>) {
    return fastify.inject({ method: 'GET', url, headers })
  }

  async function getJson<T>(url: string): Promise<T> {
    const response = await get(url)
    expect(response.statusCode).toBe(200)
    return JSON.parse(response.payload) as T
  }

  describe('GET /api/sessions', () => {
    it('lists the fixture session with derived metadata', async () => {
      const sessions = await getJson<unknown[]>('/api/sessions')

      expect(sessions).toHaveLength(1)
      const session = sessions[0]
      sessionSchema.parse(session)
      expect(session).toMatchObject({
        ...TEST_SESSION,
        dataTier: 'full',
        winner: TEST_DRIVER_ID,
        trackOutline: TEST_TRACK.outline,
      })
    })
  })

  describe('GET /api/sessions/:id', () => {
    it('returns a session by ID', async () => {
      const session = await getJson<unknown>(
        `/api/sessions/${TEST_SESSION_ID}`,
      )

      sessionSchema.parse(session)
      expect(session).toMatchObject({
        ...TEST_SESSION,
        dataTier: 'full',
        winner: TEST_DRIVER_ID,
      })
    })

    it('returns 404 for a non-existent session', async () => {
      const response = await get('/api/sessions/non-existent-session-id')

      expect(response.statusCode).toBe(404)
    })
  })

  describe('static session artifacts', () => {
    it('returns the manifest', async () => {
      const manifest = await getJson<unknown>(
        `/api/sessions/${TEST_SESSION_ID}/manifest`,
      )

      expect(manifestSchema.parse(manifest)).toEqual(TEST_MANIFEST)
    })

    it('returns the track', async () => {
      const track = await getJson<unknown>(
        `/api/sessions/${TEST_SESSION_ID}/track`,
      )

      expect(trackSchema.parse(track)).toEqual(TEST_TRACK)
    })

    it('returns the drivers', async () => {
      const drivers = await getJson<Driver[]>(
        `/api/sessions/${TEST_SESSION_ID}/drivers`,
      )

      expect(drivers.map((driver) => driverSchema.parse(driver))).toEqual(
        TEST_DRIVERS,
      )
    })

    it('returns the results', async () => {
      const results = await getJson<Result[]>(
        `/api/sessions/${TEST_SESSION_ID}/results`,
      )

      expect(results.map((result) => resultSchema.parse(result))).toEqual(
        TEST_RESULTS,
      )
    })

    it.each(['manifest', 'track', 'drivers', 'results'])(
      'returns 404 for %s of a non-existent session',
      async (artifact) => {
        const response = await get(
          `/api/sessions/non-existent-session-id/${artifact}`,
        )

        expect(response.statusCode).toBe(404)
      },
    )
  })

  describe('GET /api/sessions/:id/laps', () => {
    it('returns every lap for a session', async () => {
      const laps = await getJson<Lap[]>(
        `/api/sessions/${TEST_SESSION_ID}/laps`,
      )

      expect(laps).toHaveLength(TEST_LAPS.length)
      expect(laps).toEqual(expect.arrayContaining(TEST_LAPS))
      laps.forEach((lap) => lapSchema.parse(lap))
    })

    it('returns laps for a driver in a session', async () => {
      const laps = await getJson<Lap[]>(
        `/api/sessions/${TEST_SESSION_ID}/drivers/${TEST_DRIVER_ID}/laps`,
      )

      expect(laps).toEqual(
        TEST_LAPS.filter((lap) => lap.driverId === TEST_DRIVER_ID),
      )
      laps.forEach((lap) => lapSchema.parse(lap))
    })

    it.each(['laps', `drivers/${TEST_DRIVER_ID}/laps`])(
      'returns 404 for %s of a non-existent session',
      async (path) => {
        const response = await get(
          `/api/sessions/non-existent-session-id/${path}`,
        )

        expect(response.statusCode).toBe(404)
      },
    )
  })

  describe('GET /api/sessions/:id/stints', () => {
    it('returns every stint for a session', async () => {
      const stints = await getJson<Stint[]>(
        `/api/sessions/${TEST_SESSION_ID}/stints`,
      )

      expect(stints).toHaveLength(TEST_STINTS.length)
      expect(stints).toEqual(expect.arrayContaining(TEST_STINTS))
      stints.forEach((stint) => stintSchema.parse(stint))
    })

    it('returns stints for a driver in a session', async () => {
      const stints = await getJson<Stint[]>(
        `/api/sessions/${TEST_SESSION_ID}/drivers/${TEST_DRIVER_ID}/stints`,
      )

      expect(stints).toEqual(
        TEST_STINTS.filter((stint) => stint.driverId === TEST_DRIVER_ID),
      )
      stints.forEach((stint) => stintSchema.parse(stint))
    })

    it.each(['stints', `drivers/${TEST_DRIVER_ID}/stints`])(
      'returns 404 for %s of a non-existent session',
      async (path) => {
        const response = await get(
          `/api/sessions/non-existent-session-id/${path}`,
        )

        expect(response.statusCode).toBe(404)
      },
    )
  })

  describe('GET /api/sessions/:id/pit-stops', () => {
    it('returns every pit stop for a session', async () => {
      const pitStops = await getJson<PitStop[]>(
        `/api/sessions/${TEST_SESSION_ID}/pit-stops`,
      )

      expect(pitStops).toHaveLength(TEST_PIT_STOPS.length)
      expect(pitStops).toEqual(expect.arrayContaining(TEST_PIT_STOPS))
      pitStops.forEach((pitStop) => pitStopSchema.parse(pitStop))
    })

    it('returns pit stops for a driver in a session', async () => {
      const pitStops = await getJson<PitStop[]>(
        `/api/sessions/${TEST_SESSION_ID}/drivers/${TEST_DRIVER_ID}/pit-stops`,
      )

      expect(pitStops).toEqual(
        TEST_PIT_STOPS.filter((pitStop) => pitStop.driverId === TEST_DRIVER_ID),
      )
      pitStops.forEach((pitStop) => pitStopSchema.parse(pitStop))
    })

    it.each(['pit-stops', `drivers/${TEST_DRIVER_ID}/pit-stops`])(
      'returns 404 for %s of a non-existent session',
      async (path) => {
        const response = await get(
          `/api/sessions/non-existent-session-id/${path}`,
        )

        expect(response.statusCode).toBe(404)
      },
    )
  })

  describe('GET /api/sessions/:id/events', () => {
    it('returns every event for a session', async () => {
      const events = await getJson<Event[]>(
        `/api/sessions/${TEST_SESSION_ID}/events`,
      )

      expect(events).toHaveLength(TEST_EVENTS.length)
      expect(events).toEqual(expect.arrayContaining(TEST_EVENTS))
      events.forEach((event) => eventSchema.parse(event))
    })

    it('returns driver events plus session-wide events for a driver', async () => {
      const events = await getJson<Event[]>(
        `/api/sessions/${TEST_SESSION_ID}/drivers/${TEST_DRIVER_ID}/events`,
      )

      expect(events).toEqual(
        expect.arrayContaining([
          TEST_EVENTS[0],
          TEST_EVENTS[1],
        ]),
      )
      expect(
        events.some((event) => event.driverId === TEST_OTHER_DRIVER_ID),
      ).toBe(false)
      events.forEach((event) => eventSchema.parse(event))
    })

    it.each(['events', `drivers/${TEST_DRIVER_ID}/events`])(
      'returns 404 for %s of a non-existent session',
      async (path) => {
        const response = await get(
          `/api/sessions/non-existent-session-id/${path}`,
        )

        expect(response.statusCode).toBe(404)
      },
    )
  })

  describe('GET /api/sessions/:id/binary/*', () => {
    it('serves a motion chunk with an ETag', async () => {
      const response = await get(
        `/api/sessions/${TEST_SESSION_ID}/binary/motion/0`,
      )

      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('application/octet-stream')
      expect(response.headers.etag).toMatch(/^"[a-f0-9]{32}"$/)
      expect(response.rawPayload.equals(TEST_MOTION_CHUNK)).toBe(true)
    })

    it('serves gaps data with an ETag', async () => {
      const response = await get(
        `/api/sessions/${TEST_SESSION_ID}/binary/gaps`,
      )

      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('application/octet-stream')
      expect(response.headers.etag).toMatch(/^"[a-f0-9]{32}"$/)
      expect(response.rawPayload.equals(TEST_GAPS)).toBe(true)
    })

    it('supports ETag caching (304 Not Modified)', async () => {
      const url = `/api/sessions/${TEST_SESSION_ID}/binary/motion/0`
      const first = await get(url)
      expect(first.statusCode).toBe(200)

      const etag = first.headers.etag
      expect(etag).toBeDefined()

      const second = await get(url, { 'if-none-match': String(etag) })
      expect(second.statusCode).toBe(304)
    })

    it('returns 404 for a missing binary chunk', async () => {
      const response = await get(
        `/api/sessions/${TEST_SESSION_ID}/binary/motion/1`,
      )

      expect(response.statusCode).toBe(404)
    })

    it('returns 404 for a non-existent session', async () => {
      const response = await get(
        '/api/sessions/non-existent-session-id/binary/motion/0',
      )

      expect(response.statusCode).toBe(404)
    })

    it('returns 404 when path traversal changes the route', async () => {
      const response = await get(
        `/api/sessions/${TEST_SESSION_ID}/binary/../etc/passwd/0`,
      )

      expect(response.statusCode).toBe(404)
    })

    it('rejects path traversal in the chunk index', async () => {
      const response = await get(
        `/api/sessions/${TEST_SESSION_ID}/binary/motion/../etc/passwd`,
      )

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for a missing chunk index for motion data', async () => {
      const response = await get(
        `/api/sessions/${TEST_SESSION_ID}/binary/motion`,
      )

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for an invalid binary type', async () => {
      const response = await get(
        `/api/sessions/${TEST_SESSION_ID}/binary/invalid/0`,
      )

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for a chunk index on gaps data', async () => {
      const response = await get(
        `/api/sessions/${TEST_SESSION_ID}/binary/gaps/0`,
      )

      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for a non-numeric chunk index', async () => {
      const response = await get(
        `/api/sessions/${TEST_SESSION_ID}/binary/motion/not-a-number`,
      )

      expect(response.statusCode).toBe(400)
    })
  })
})
