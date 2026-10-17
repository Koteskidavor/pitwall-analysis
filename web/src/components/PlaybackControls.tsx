import React from 'react'
import { useAppDispatch, useAppSelector } from '../store'
import {
  DEFAULT_SEEK_MS,
  PLAYBACK_SPEEDS,
  rewind,
  selectIsPlaying,
  selectPlaybackSpeed,
  setPlaying,
  setSpeed,
} from '../playbackSlice'

export const PlaybackControls: React.FC = () => {
  const dispatch = useAppDispatch()
  const playing = useAppSelector(selectIsPlaying)
  const speed = useAppSelector(selectPlaybackSpeed)

  return (
    <div className="playback-controls">
      <button type="button" onClick={() => dispatch(setPlaying(!playing))}>
        {playing ? 'Pause' : 'Play'}
      </button>
      <button type="button" onClick={() => dispatch(rewind(DEFAULT_SEEK_MS))}>
        Rewind {DEFAULT_SEEK_MS / 1000}s
      </button>
      <div role="group" aria-label="Playback speed">
        {PLAYBACK_SPEEDS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={option === speed}
            onClick={() => dispatch(setSpeed(option))}
          >
            {option}×
          </button>
        ))}
      </div>
    </div>
  )
}
