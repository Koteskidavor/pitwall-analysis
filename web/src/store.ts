import { configureStore } from '@reduxjs/toolkit'
import { apiSlice } from './apiSlice'
import { uiReducer } from './uiSlice'
import { playbackReducer } from './playbackSlice'
import {
  createPlaybackEngineHost,
  createPlaybackListenerMiddleware,
  type PlaybackEngine,
} from './playbackMiddleware'
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux'

// Build a store with an injected playback engine. Tests pass a fake; the app
// passes the real engine (or the host, which can be pointed at it later).
export function createAppStore(engine: PlaybackEngine = createPlaybackEngineHost()) {
  const playback = createPlaybackListenerMiddleware(engine)

  return configureStore({
    reducer: {
      [apiSlice.reducerPath]: apiSlice.reducer,
      ui: uiReducer,
      playback: playbackReducer,
    },
    // The playback bridge runs before the default middleware so transport
    // commands reach the engine as soon as they are dispatched.
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().prepend(playback.middleware).concat(apiSlice.middleware),
  })
}

// The app singleton starts with a no-op engine; attach the real one once the
// session manifest is loaded.
export const playbackEngineHost = createPlaybackEngineHost()
export const store = createAppStore(playbackEngineHost)

export function setPlaybackEngine(engine: PlaybackEngine): void {
  playbackEngineHost.set(engine)
}

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

// Use throughout the app instead of plain `useDispatch` and `useSelector`
export const useAppDispatch: () => AppDispatch = useDispatch
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
