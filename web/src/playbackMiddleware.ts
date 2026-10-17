import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit'
import {
  rewind,
  seek,
  seekBy,
  setPlaying,
  setSpeed,
  togglePlaying,
  type PlaybackState,
} from './playbackSlice'

// The narrow port the bridge needs from the playback engine. The concrete
// RaceEngine satisfies it structurally; tests can pass a fake.
export interface PlaybackEngine {
  play(): void
  pause(): void
  seek(timeMs: number): void
  seekBy(deltaMs: number): void
  rewind(deltaMs: number): void
  setSpeed(speed: number): void
}

export function createNoopPlaybackEngine(): PlaybackEngine {
  return {
    play() {},
    pause() {},
    seek() {},
    seekBy() {},
    rewind() {},
    setSpeed() {},
  }
}

// Lets the singleton store start before the real engine exists and have the
// engine attached later without recreating the store.
export interface PlaybackEngineHost extends PlaybackEngine {
  set(engine: PlaybackEngine): void
  get current(): PlaybackEngine
}

export function createPlaybackEngineHost(
  initial: PlaybackEngine = createNoopPlaybackEngine(),
): PlaybackEngineHost {
  let engine = initial
  return {
    get current() {
      return engine
    },
    set(next) {
      engine = next
    },
    play() {
      engine.play()
    },
    pause() {
      engine.pause()
    },
    seek(timeMs) {
      engine.seek(timeMs)
    },
    seekBy(deltaMs) {
      engine.seekBy(deltaMs)
    },
    rewind(deltaMs) {
      engine.rewind(deltaMs)
    },
    setSpeed(speed) {
      engine.setSpeed(speed)
    },
  }
}

interface PlaybackRootState {
  playback: PlaybackState
}

export function createPlaybackListenerMiddleware(engine: PlaybackEngine) {
  const listener = createListenerMiddleware<PlaybackRootState>()

  listener.startListening({
    actionCreator: setSpeed,
    effect: (action) => {
      engine.setSpeed(action.payload)
    },
  })

  // Both explicit and toggled play state resolve against the store, which the
  // reducer has already updated by the time effects run.
  listener.startListening({
    matcher: isAnyOf(setPlaying, togglePlaying),
    effect: (_action, api) => {
      if (api.getState().playback.playing) engine.play()
      else engine.pause()
    },
  })

  listener.startListening({
    actionCreator: seek,
    effect: (action) => {
      engine.seek(action.payload)
    },
  })

  listener.startListening({
    actionCreator: seekBy,
    effect: (action) => {
      engine.seekBy(action.payload)
    },
  })

  listener.startListening({
    actionCreator: rewind,
    effect: (action) => {
      engine.rewind(action.payload)
    },
  })

  return listener
}
