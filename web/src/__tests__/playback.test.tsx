import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { Provider } from 'react-redux'
import { createAppStore } from '../store'
import type { PlaybackEngine } from '../playbackMiddleware'
import {
  DEFAULT_SEEK_MS,
  rewind,
  seek,
  seekBy,
  selectIsPlaying,
  selectPlaybackSpeed,
  setPlaying,
  setSpeed,
  togglePlaying,
} from '../playbackSlice'
import { PlaybackControls } from '../components/PlaybackControls'
import { Scrubber } from '../components/Scrubber'
import { EngineProvider, type EngineSnapshotSource } from '../engineContext'
import { usePlaybackKeyboard } from '../usePlaybackKeyboard'
import type { EngineSnapshot, SnapshotListener } from '../engine'

function makeFakeEngine() {
  return {
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    seekBy: vi.fn(),
    rewind: vi.fn(),
    setSpeed: vi.fn(),
  } satisfies PlaybackEngine
}

function makeSnapshotSource(overrides: Partial<EngineSnapshot> = {}): EngineSnapshotSource & {
  push: (next: Partial<EngineSnapshot>) => void
} {
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
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    push: (next) => {
      snapshot = { ...snapshot, ...next }
      listeners.forEach((listener) => listener(snapshot))
    },
  }
}

// Collects any key that looks like it is tracking the playhead.
function findPlayheadKeys(value: unknown, path = ''): string[] {
  if (value === null || typeof value !== 'object') return []
  const found: string[] = []
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const full = path ? `${path}.${key}` : key
    if (/time|playhead|position/i.test(key)) found.push(full)
    found.push(...findPlayheadKeys(child, full))
  }
  return found
}

describe('CP10: playback bridge and controls', () => {
  describe('listener middleware', () => {
    it('dispatches setSpeed(8) and the fake engine receives 8', () => {
      const engine = makeFakeEngine()
      const store = createAppStore(engine)

      store.dispatch(setSpeed(8))

      expect(engine.setSpeed).toHaveBeenCalledWith(8)
      expect(engine.setSpeed).toHaveBeenCalledTimes(1)
      expect(selectPlaybackSpeed(store.getState())).toBe(8)
    })

    it('keeps the playhead out of the store', () => {
      const store = createAppStore(makeFakeEngine())

      store.dispatch(setPlaying(true))
      store.dispatch(setSpeed(16))
      store.dispatch(seek(12345))
      store.dispatch(seekBy(1000))
      store.dispatch(rewind(2000))

      expect(findPlayheadKeys(store.getState())).toEqual([])
      expect(Object.keys(store.getState().playback).sort()).toEqual(['playing', 'speed'])
      expect(JSON.stringify(store.getState().playback)).not.toMatch(/time|playhead|position/i)
    })

    it('forwards play and pause to the engine', () => {
      const engine = makeFakeEngine()
      const store = createAppStore(engine)

      store.dispatch(setPlaying(true))
      expect(engine.play).toHaveBeenCalledTimes(1)
      expect(engine.pause).not.toHaveBeenCalled()

      store.dispatch(setPlaying(false))
      expect(engine.pause).toHaveBeenCalledTimes(1)
    })

    it('togglePlaying flips state and drives the engine', () => {
      const engine = makeFakeEngine()
      const store = createAppStore(engine)

      store.dispatch(togglePlaying())

      expect(selectIsPlaying(store.getState())).toBe(true)
      expect(engine.play).toHaveBeenCalledTimes(1)
    })

    it('forwards seek, seekBy and rewind intents', () => {
      const engine = makeFakeEngine()
      const store = createAppStore(engine)

      store.dispatch(seek(42000))
      store.dispatch(seekBy(DEFAULT_SEEK_MS))
      store.dispatch(rewind(DEFAULT_SEEK_MS))

      expect(engine.seek).toHaveBeenCalledWith(42000)
      expect(engine.seekBy).toHaveBeenCalledWith(DEFAULT_SEEK_MS)
      expect(engine.rewind).toHaveBeenCalledWith(DEFAULT_SEEK_MS)
    })
  })

  describe('controls', () => {
    const renderControls = (engine: PlaybackEngine = makeFakeEngine()) => {
      const store = createAppStore(engine)
      render(
        <Provider store={store}>
          <PlaybackControls />
        </Provider>,
      )
      return store
    }

    it('speed buttons dispatch the chosen speed to the engine', () => {
      const engine = makeFakeEngine()
      renderControls(engine)

      fireEvent.click(screen.getByRole('button', { name: '8×' }))

      expect(engine.setSpeed).toHaveBeenCalledWith(8)
    })

    it('play button starts playback and shows pause while playing', () => {
      const engine = makeFakeEngine()
      renderControls(engine)

      fireEvent.click(screen.getByRole('button', { name: 'Play' }))

      expect(engine.play).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    })

    it('rewind button dispatches the default seek window', () => {
      const engine = makeFakeEngine()
      renderControls(engine)

      fireEvent.click(screen.getByRole('button', { name: /rewind/i }))

      expect(engine.rewind).toHaveBeenCalledWith(DEFAULT_SEEK_MS)
    })

    it('scrubber seeks the engine to the chosen time', () => {
      const engine = makeFakeEngine()
      const store = createAppStore(engine)
      const source = makeSnapshotSource()

      render(
        <Provider store={store}>
          <EngineProvider engine={source}>
            <Scrubber />
          </EngineProvider>
        </Provider>,
      )

      fireEvent.change(screen.getByLabelText('Scrubber'), { target: { value: '42000' } })

      expect(engine.seek).toHaveBeenCalledWith(42000)
    })

    it('scrubber reads its position from the engine, not the store', () => {
      const source = makeSnapshotSource()
      render(
        <Provider store={createAppStore(makeFakeEngine())}>
          <EngineProvider engine={source}>
            <Scrubber />
          </EngineProvider>
        </Provider>,
      )

      act(() => {
        source.push({ timeMs: 65000 })
      })

      expect(screen.getByText('1:05 / 1:40')).toBeInTheDocument()
    })
  })

  describe('keyboard controls', () => {
    const KeyboardProbe: React.FC = () => {
      usePlaybackKeyboard()
      return null
    }

    const renderKeyboard = (engine: PlaybackEngine = makeFakeEngine()) => {
      const store = createAppStore(engine)
      render(
        <Provider store={store}>
          <KeyboardProbe />
        </Provider>,
      )
      return store
    }

    it('space toggles play/pause', () => {
      const engine = makeFakeEngine()
      const store = renderKeyboard(engine)

      fireEvent.keyDown(window, { key: ' ' })

      expect(selectIsPlaying(store.getState())).toBe(true)
      expect(engine.play).toHaveBeenCalledTimes(1)
    })

    it('left arrow rewinds and right arrow skips forward', () => {
      const engine = makeFakeEngine()
      renderKeyboard(engine)

      fireEvent.keyDown(window, { key: 'ArrowLeft' })
      fireEvent.keyDown(window, { key: 'ArrowRight' })

      expect(engine.rewind).toHaveBeenCalledWith(DEFAULT_SEEK_MS)
      expect(engine.seekBy).toHaveBeenCalledWith(DEFAULT_SEEK_MS)
    })
  })
})
