import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { Provider } from 'react-redux'
import type { Track } from '../../../shared/src/schemas'
import { TrackMap } from '../components/TrackMap'
import { createAppStore } from '../store'
import { EngineProvider, type EngineSnapshotSource } from '../engineContext'
import { DRIVER_STATUS, type EngineSnapshot, type MotionSample, type SnapshotListener } from '../engine'
import {
  createViewTransform,
  findNearestDriver,
  screenToWorld,
  worldToScreen,
} from '../trackGeometry'

const WIDTH = 200
const HEIGHT = 200

const track: Track = {
  outline: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ],
  sector1: { outer: [{ x: 0, y: 0 }, { x: 50, y: 0 }], inner: null },
  sector2: { outer: [{ x: 50, y: 0 }, { x: 100, y: 0 }], inner: null },
  bounds: { x: 0, y: 0 },
}

const viewTransform = () => createViewTransform(track.outline, WIDTH, HEIGHT)

function makeSample(
  driverId: string,
  x: number,
  y: number,
  status: number = DRIVER_STATUS.RUNNING,
): MotionSample {
  return { driverId, progress: 0, x, y, speed: 100, status }
}

function makeSource(overrides: Partial<EngineSnapshot> = {}) {
  let snapshot: EngineSnapshot = {
    timeMs: 0,
    durationMs: 100000,
    speed: 1,
    playing: false,
    ended: false,
    ready: true,
    samples: [],
    ...overrides,
  }
  const listeners = new Set<SnapshotListener>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: SnapshotListener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    push: (next: Partial<EngineSnapshot>) => {
      snapshot = { ...snapshot, ...next }
      listeners.forEach((listener) => listener(snapshot))
    },
  }
}

type FakeContext = ReturnType<typeof makeFakeContext>

function makeFakeContext() {
  return {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    fillText: vi.fn(),
    setLineDash: vi.fn(),
    lineJoin: '',
    lineCap: '',
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
  }
}

describe('Track map', () => {
  let contextByCanvas: WeakMap<HTMLCanvasElement, FakeContext>

  beforeEach(() => {
    contextByCanvas = new WeakMap()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      // eslint-disable-next-line no-unused-vars -- this is the canvas under test
      function (this: HTMLCanvasElement) {
        let context = contextByCanvas.get(this)
        if (!context) {
          context = makeFakeContext()
          contextByCanvas.set(this, context)
        }
        return context as unknown as CanvasRenderingContext2D
      } as never,
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderMap(source: EngineSnapshotSource) {
    const store = createAppStore()
    render(
      <Provider store={store}>
        <EngineProvider engine={source}>
          <TrackMap track={track} width={WIDTH} height={HEIGHT} />
        </EngineProvider>
      </Provider>,
    )
    const dynamic = screen.getByTestId('track-map-dynamic') as HTMLCanvasElement
    const staticCanvas = screen.getByTestId('track-map-static') as HTMLCanvasElement
    return { store, dynamic, staticCanvas }
  }

  function clickWorld(dynamic: HTMLCanvasElement, point: { x: number; y: number }) {
    const screenPoint = worldToScreen(point, viewTransform())
    fireEvent.click(dynamic, { clientX: screenPoint.x, clientY: screenPoint.y })
  }

  describe('canvas layers', () => {
    it('renders a static and a dynamic layer', () => {
      const source = makeSource()
      renderMap(source)

      expect(screen.getByTestId('track-map-static')).toBeInTheDocument()
      expect(screen.getByTestId('track-map-dynamic')).toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'Track map' })).toBe(
        screen.getByTestId('track-map-dynamic'),
      )
    })

    it('draws the track outline on the static layer only', () => {
      const source = makeSource()
      const { staticCanvas, dynamic } = renderMap(source)

      const staticContext = contextByCanvas.get(staticCanvas)!
      const dynamicContext = contextByCanvas.get(dynamic)!

      // Outline has 4 points + closePath, so moveTo once and lineTo for the rest.
      expect(staticContext.moveTo).toHaveBeenCalledTimes(1)
      expect(staticContext.lineTo).toHaveBeenCalledTimes(3)
      expect(dynamicContext.moveTo).not.toHaveBeenCalled()
    })

    it('draws one marker per visible driver on the dynamic layer', () => {
      const source = makeSource({
        samples: [
          makeSample('VER', 0, 0),
          makeSample('HAM', 100, 100),
          makeSample('OUT', 50, 50, DRIVER_STATUS.OUT),
        ],
      })
      const { dynamic } = renderMap(source)

      const dynamicContext = contextByCanvas.get(dynamic)!
      // Retired cars are not on track, so only VER and HAM get a marker.
      expect(dynamicContext.arc).toHaveBeenCalledTimes(2)
      const labels = dynamicContext.fillText.mock.calls.map((call) => call[0])
      expect(labels).toEqual(expect.arrayContaining(['VER', 'HAM']))
      expect(labels).not.toContain('OUT')
    })

    it('redraws the dynamic layer when the engine publishes a frame', () => {
      const source = makeSource({ samples: [] })
      const { dynamic } = renderMap(source)
      const dynamicContext = contextByCanvas.get(dynamic)!

      expect(dynamicContext.arc).not.toHaveBeenCalled()

      act(() => {
        source.push({ samples: [makeSample('VER', 10, 10)] })
      })

      expect(dynamicContext.arc).toHaveBeenCalledTimes(1)
    })
  })

  describe('selection', () => {
    it('selects the driver under the click and stores it in Redux', () => {
      const source = makeSource({
        samples: [makeSample('VER', 0, 0), makeSample('HAM', 100, 100)],
      })
      const { store, dynamic } = renderMap(source)

      clickWorld(dynamic, { x: 0, y: 0 })

      expect(store.getState().ui.selectedDriverId).toBe('VER')
      expect(screen.getByTestId('track-map')).toHaveAttribute('data-selected-driver', 'VER')
    })

    it('selects the nearest driver when several are close', () => {
      const source = makeSource({
        samples: [makeSample('VER', 0, 0), makeSample('HAM', 10, 0)],
      })
      const { store, dynamic } = renderMap(source)

      clickWorld(dynamic, { x: 2, y: 0 })

      expect(store.getState().ui.selectedDriverId).toBe('VER')
    })

    it('ignores retired drivers when hit-testing', () => {
      const source = makeSource({
        samples: [
          makeSample('RETIRED', 0, 0, DRIVER_STATUS.OUT),
          makeSample('HAM', 5, 0),
        ],
      })
      const { store, dynamic } = renderMap(source)

      clickWorld(dynamic, { x: 0, y: 0 })

      expect(store.getState().ui.selectedDriverId).toBe('HAM')
    })

    it('clears the selection when clicking empty space', () => {
      const source = makeSource({ samples: [makeSample('VER', 0, 0)] })
      const { store, dynamic } = renderMap(source)

      clickWorld(dynamic, { x: 0, y: 0 })
      expect(store.getState().ui.selectedDriverId).toBe('VER')

      clickWorld(dynamic, { x: 100, y: 100 })

      expect(store.getState().ui.selectedDriverId).toBeNull()
      expect(screen.getByTestId('track-map')).toHaveAttribute('data-selected-driver', '')
    })

    it('does not select a driver that is outside the hit radius', () => {
      const source = makeSource({ samples: [makeSample('VER', 0, 0)] })
      const { store, dynamic } = renderMap(source)

      // A world delta of 30 is ~50px away at this scale, beyond the 18px radius.
      clickWorld(dynamic, { x: 30, y: 0 })

      expect(store.getState().ui.selectedDriverId).toBeNull()
    })
  })

  describe('trackGeometry', () => {
    it('round-trips world coordinates through the screen', () => {
      const transform = viewTransform()
      const world = { x: 25, y: 75 }

      const roundTripped = screenToWorld(worldToScreen(world, transform), transform)

      expect(roundTripped.x).toBeCloseTo(world.x, 6)
      expect(roundTripped.y).toBeCloseTo(world.y, 6)
    })

    it('returns null from hit-testing when nothing is in range', () => {
      const transform = viewTransform()
      const samples = [makeSample('VER', 0, 0)]

      const result = findNearestDriver(samples, { x: 500, y: 500 }, transform, 18)

      expect(result).toBeNull()
    })
  })
})
