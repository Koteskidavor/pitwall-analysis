import { describe, it, expect, vi } from 'vitest'
import { RaceEngine, DRIVER_STATUS, type EngineSnapshot, type RaceEngineOptions } from '../engine'
import type { Manifest } from '@pitwall/shared'

const manifest: Manifest = {
  schemaVersion: '1.0.0',
  sampleHz: 5,
  chunkSeconds: 60,
  driverOrder: ['VER', 'HAM'],
  chunkCount: 3,
  trackLengthM: 1000,
  durationMs: 150000,
  availableLayers: ['motion', 'gaps'],
}

const STEP_COUNT = manifest.chunkSeconds * manifest.sampleHz

interface StepValues {
  progress: number
  x: number
  y: number
  speed: number
  status: number
}

function encodeMotionChunk(
  baseStep: number,
  value: (driverIndex: number, globalStep: number) => StepValues,
): ArrayBuffer {
  const driverCount = manifest.driverOrder.length
  const elementCount = driverCount * STEP_COUNT
  const buffer = new ArrayBuffer(elementCount * 17)
  const view = new DataView(buffer)

  const progressBase = 0
  const xBase = elementCount * 4
  const yBase = 2 * elementCount * 4
  const speedBase = 3 * elementCount * 4
  const statusBase = 4 * elementCount * 4

  for (let d = 0; d < driverCount; d++) {
    for (let s = 0; s < STEP_COUNT; s++) {
      const globalStep = baseStep + s
      const planeIndex = d * STEP_COUNT + s
      const byteIndex = planeIndex * 4
      const sample = value(d, globalStep)

      view.setFloat32(progressBase + byteIndex, sample.progress, true)
      view.setFloat32(xBase + byteIndex, sample.x, true)
      view.setFloat32(yBase + byteIndex, sample.y, true)
      view.setFloat32(speedBase + byteIndex, sample.speed, true)
      view.setUint8(statusBase + planeIndex, sample.status)
    }
  }

  return buffer
}

function makeLoader() {
  return vi.fn(async (chunkIndex: number) =>
    encodeMotionChunk(chunkIndex * STEP_COUNT, (driverIndex, globalStep) => ({
      progress: globalStep,
      x: globalStep,
      y: globalStep * 2,
      speed: globalStep,
      status:
        driverIndex === 1 && globalStep >= 450 ? DRIVER_STATUS.OUT : DRIVER_STATUS.RUNNING,
    })),
  )
}

function createEngine(overrides: Partial<Omit<RaceEngineOptions, 'manifest' | 'loadChunk'>> = {}) {
  const loadChunk = makeLoader()
  const engine = new RaceEngine({ manifest, loadChunk, ...overrides })
  return { engine, loadChunk }
}

describe('Engine', () => {
  describe('playhead', () => {
    it('starts at zero, paused', () => {
      const { engine } = createEngine()
      expect(engine.currentTimeMs).toBe(0)
      expect(engine.isPlaying).toBe(false)
    })

    it('seek moves the playhead and publishes a snapshot', () => {
      const { engine } = createEngine()
      const snapshots: EngineSnapshot[] = []
      engine.subscribe((snapshot) => snapshots.push(snapshot))

      engine.seek(1000)

      expect(engine.currentTimeMs).toBe(1000)
      expect(snapshots).toHaveLength(1)
      expect(snapshots[0].timeMs).toBe(1000)
      expect(snapshots[0].playing).toBe(false)
    })

    it('seek clamps below zero and above the race duration', () => {
      const { engine } = createEngine()

      engine.seek(-5000)
      expect(engine.currentTimeMs).toBe(0)

      engine.seek(manifest.durationMs + 9999)
      expect(engine.currentTimeMs).toBe(manifest.durationMs)
    })

    it('seek to the end marks the race as ended and stops playback', () => {
      const { engine } = createEngine()
      engine.play()

      engine.seek(manifest.durationMs)

      expect(engine.currentTimeMs).toBe(manifest.durationMs)
      expect(engine.isPlaying).toBe(false)
      expect(engine.getSnapshot().ended).toBe(true)
    })

    it('rewind moves the playhead backwards and clamps at zero', () => {
      const { engine } = createEngine()

      engine.seek(5000)
      engine.rewind(2000)
      expect(engine.currentTimeMs).toBe(3000)

      engine.rewind(10000)
      expect(engine.currentTimeMs).toBe(0)
    })

    it('tick advances only while playing', () => {
      const { engine } = createEngine()

      engine.tick(500)
      expect(engine.currentTimeMs).toBe(0)

      engine.play()
      engine.tick(500)
      expect(engine.currentTimeMs).toBe(500)
      engine.tick(500)
      expect(engine.currentTimeMs).toBe(1000)
    })

    it('play from the end restarts at zero', () => {
      const { engine } = createEngine()
      engine.seek(manifest.durationMs)

      engine.play()

      expect(engine.currentTimeMs).toBe(0)
      expect(engine.isPlaying).toBe(true)
      expect(engine.getSnapshot().ended).toBe(false)
    })
  })

  describe('interpolation', () => {
    it('sample(t) linearly interpolates between adjacent steps', async () => {
      const { engine } = createEngine()
      engine.seek(1500)
      await engine.whenReady()

      const samples = engine.sample()
      expect(samples).not.toBeNull()
      const ver = samples!.find((s) => s.driverId === 'VER')!
      expect(ver.x).toBeCloseTo(7.5, 5)
      expect(ver.y).toBeCloseTo(15, 5)
      expect(ver.progress).toBeCloseTo(7.5, 5)
      expect(ver.speed).toBeCloseTo(7.5, 5)
    })

    it('sample(timeMs) can sample an arbitrary time', async () => {
      const { engine } = createEngine()
      engine.seek(0)
      await engine.whenReady(4000)

      const samples = engine.sample(4000)
      expect(samples!.find((s) => s.driverId === 'VER')!.x).toBeCloseTo(20, 5)
    })

    it('returns an exact sample when the time lands on a grid point', async () => {
      const { engine } = createEngine()
      engine.seek(1000)
      await engine.whenReady()

      const ver = engine.sample()!.find((s) => s.driverId === 'VER')!
      expect(ver.x).toBe(5)
    })

    it('sample is null until the required chunk is loaded', () => {
      const { engine } = createEngine()
      engine.seek(1000)
      expect(engine.sample()).toBeNull()
      expect(engine.getSnapshot().ready).toBe(false)
    })
  })

  describe('chunk boundaries', () => {
    it('interpolates across a chunk boundary using both chunks', async () => {
      const { engine, loadChunk } = createEngine()
      engine.seek(60000 - 100)
      await engine.whenReady()

      const ver = engine.sample()!.find((s) => s.driverId === 'VER')!
      expect(ver.x).toBeCloseTo(299.5, 5)
      expect(loadChunk).toHaveBeenCalledWith(0)
      expect(loadChunk).toHaveBeenCalledWith(1)
    })

    it('samples exactly on a chunk boundary', async () => {
      const { engine } = createEngine()
      engine.seek(60000)
      await engine.whenReady()

      const ver = engine.sample()!.find((s) => s.driverId === 'VER')!
      expect(ver.x).toBe(300)
    })

    it('samples the first step of the second chunk', async () => {
      const { engine } = createEngine()
      engine.seek(60000)
      await engine.whenReady()

      const ham = engine.sample()!.find((s) => s.driverId === 'HAM')!
      expect(ham.x).toBe(300)
    })
  })

  describe('end of race', () => {
    it('tick clamps to the race duration and stops playback', () => {
      const { engine } = createEngine()
      engine.play()

      engine.tick(manifest.durationMs + 5000)

      expect(engine.currentTimeMs).toBe(manifest.durationMs)
      expect(engine.isPlaying).toBe(false)
      expect(engine.getSnapshot().ended).toBe(true)
    })

    it('sample at the end returns the final frame', async () => {
      const { engine } = createEngine()
      engine.seek(manifest.durationMs)
      await engine.whenReady()

      const samples = engine.sample()
      expect(samples).not.toBeNull()
      const ver = samples!.find((s) => s.driverId === 'VER')!
      expect(ver.x).toBe(750)
      const ham = samples!.find((s) => s.driverId === 'HAM')!
      expect(ham.status).toBe(DRIVER_STATUS.OUT)
    })
  })

  describe('chunk loader', () => {
    it('prefetches chunks ahead of the playhead', () => {
      const { engine, loadChunk } = createEngine({ prefetchDepth: 2 })

      engine.seek(0)

      const requested = loadChunk.mock.calls.map((call) => call[0])
      expect(requested).toContain(0)
      expect(requested).toContain(1)
      expect(requested).toContain(2)
    })

    it('does not prefetch past the last chunk', () => {
      const { engine, loadChunk } = createEngine({ prefetchDepth: 3 })

      engine.seek(manifest.durationMs)

      const requested = loadChunk.mock.calls.map((call) => call[0])
      expect(requested.every((index) => index < manifest.chunkCount)).toBe(true)
    })

    it('evicts the least recently used chunk when the cache is full', async () => {
      const { engine, loadChunk } = createEngine({ cacheSize: 2, prefetchDepth: 0 })

      engine.seek(0)
      await engine.whenReady()
      engine.seek(60000)
      await engine.whenReady()
      engine.seek(120000)
      await engine.whenReady()

      expect(engine.getLoadedChunkIndices()).not.toContain(0)
      expect(engine.getLoadedChunkIndices().length).toBeLessThanOrEqual(2)

      engine.seek(0)
      await engine.whenReady()

      const chunkZeroLoads = loadChunk.mock.calls.filter((call) => call[0] === 0)
      expect(chunkZeroLoads).toHaveLength(2)
    })

    it('does not re-request a chunk that is already cached', async () => {
      const { engine, loadChunk } = createEngine({ prefetchDepth: 0 })

      engine.seek(0)
      await engine.whenReady()
      engine.seek(200)
      await engine.whenReady()

      expect(loadChunk.mock.calls.filter((call) => call[0] === 0)).toHaveLength(1)
    })
  })

  describe('CP10: playback speed', () => {
    it('scales the tick delta by the current speed', () => {
      const { engine } = createEngine()
      engine.setSpeed(8)
      engine.play()

      engine.tick(100)

      expect(engine.currentTimeMs).toBe(800)
    })

    it('exposes the speed in the snapshot and publishes on change', () => {
      const { engine } = createEngine()
      const listener = vi.fn()
      engine.subscribe(listener)

      engine.setSpeed(16)

      expect(engine.playbackSpeed).toBe(16)
      expect(engine.getSnapshot().speed).toBe(16)
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('rejects a non-positive speed', () => {
      const { engine } = createEngine()
      expect(() => engine.setSpeed(0)).toThrow()
      expect(() => engine.setSpeed(-2)).toThrow()
      expect(engine.playbackSpeed).toBe(1)
    })

    it('seekBy moves forward and backward, clamped to the race', () => {
      const { engine } = createEngine()
      engine.seek(1000)

      engine.seekBy(2500)
      expect(engine.currentTimeMs).toBe(3500)

      engine.seekBy(-1000)
      expect(engine.currentTimeMs).toBe(2500)

      engine.seekBy(-100000)
      expect(engine.currentTimeMs).toBe(0)
    })

    it('returns a stable snapshot reference until the playhead changes', () => {
      const { engine } = createEngine()
      const first = engine.getSnapshot()

      expect(engine.getSnapshot()).toBe(first)

      engine.seek(1000)
      expect(engine.getSnapshot()).not.toBe(first)
    })
  })

  describe('snapshot publishing', () => {
    it('publishes again once chunks finish loading', async () => {
      const { engine } = createEngine()
      const snapshots: EngineSnapshot[] = []
      engine.subscribe((snapshot) => snapshots.push(snapshot))

      engine.seek(0)
      await engine.whenReady()
      await Promise.resolve()

      expect(snapshots.length).toBeGreaterThan(1)
      const last = snapshots[snapshots.length - 1]
      expect(last.ready).toBe(true)
      expect(last.samples).toHaveLength(2)
    })

    it('stops notifying after unsubscribe', () => {
      const { engine } = createEngine()
      const listener = vi.fn()
      const unsubscribe = engine.subscribe(listener)

      engine.seek(0)
      expect(listener).toHaveBeenCalledTimes(1)

      unsubscribe()
      engine.seek(1000)
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })
})
