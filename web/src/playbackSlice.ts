import { createAction, createSlice, type PayloadAction } from '@reduxjs/toolkit'

export const PLAYBACK_SPEEDS = [1, 2, 4, 8, 16] as const
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number]

export const DEFAULT_SEEK_MS = 5000

export interface PlaybackState {
  speed: PlaybackSpeed
  playing: boolean
}

const initialState: PlaybackState = {
  speed: 1,
  playing: false,
}

export function isPlaybackSpeed(value: unknown): value is PlaybackSpeed {
  return typeof value === 'number' && (PLAYBACK_SPEEDS as readonly number[]).includes(value)
}

export const playbackSlice = createSlice({
  name: 'playback',
  initialState,
  reducers: {
    setSpeed(state, action: PayloadAction<PlaybackSpeed>) {
      if (isPlaybackSpeed(action.payload)) state.speed = action.payload
    },
    setPlaying(state, action: PayloadAction<boolean>) {
      state.playing = action.payload
    },
    togglePlaying(state) {
      state.playing = !state.playing
    },
  },
})

export const { setSpeed, setPlaying, togglePlaying } = playbackSlice.actions

// Transport intents are transient: they name a target time but never touch
// reducer state, so the playhead can never end up in the Redux store.
export const seek = createAction<number>('playback/seek')
export const seekBy = createAction<number>('playback/seekBy')
export const rewind = createAction<number>('playback/rewind')

export const playbackReducer = playbackSlice.reducer

export const selectPlaybackSpeed = (state: { playback: PlaybackState }) => state.playback.speed
export const selectIsPlaying = (state: { playback: PlaybackState }) => state.playback.playing
