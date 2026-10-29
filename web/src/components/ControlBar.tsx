import React, { useMemo } from 'react'
import type { Event } from '@pitwall/shared'
import { useAppDispatch, useAppSelector } from '../store'
import {
  DEFAULT_SEEK_MS,
  PLAYBACK_SPEEDS,
  rewind,
  seek,
  selectIsPlaying,
  selectPlaybackSpeed,
  setPlaying,
  setSpeed,
} from '../playbackSlice'
import { useEngineSnapshot } from '../engineContext'
import { formatRaceClock } from '../format'

export interface ControlBarProps {
  events: Event[]
  lapCount: number
  currentLap: number
}

type MarkerKind = 'safety' | 'pit' | 'flag' | 'fastlap'

function markerKind(type: string): MarkerKind | null {
  const key = type.toUpperCase()
  if (key.includes('SAFETY')) return 'safety'
  if (key.includes('FAST')) return 'fastlap'
  if (key.includes('FLAG')) return 'flag'
  if (key.includes('PIT')) return 'pit'
  return null
}

// Fixed transport bar. The playhead is read from the engine, never the store,
// so it never re-renders from Redux while scrubbing.
export const ControlBar: React.FC<ControlBarProps> = ({ events, lapCount, currentLap }) => {
  const dispatch = useAppDispatch()
  const playing = useAppSelector(selectIsPlaying)
  const speed = useAppSelector(selectPlaybackSpeed)
  const { timeMs, durationMs } = useEngineSnapshot()

  const markers = useMemo(() => {
    if (durationMs <= 0) return []
    return events
      .map((event) => ({ event, kind: markerKind(event.type) }))
      .filter((entry): entry is { event: Event; kind: MarkerKind } => entry.kind !== null)
      .map((entry) => ({
        id: `${entry.event.id}-${entry.event.timestamp_ms}`,
        kind: entry.kind,
        left: Math.min(100, Math.max(0, (entry.event.timestamp_ms / durationMs) * 100)),
      }))
  }, [events, durationMs])

  return (
    <div className="control-bar" role="toolbar" aria-label="Replay controls">
      <div className="control-bar__group">
        <button
          type="button"
          className="icon-button"
          aria-label="Rewind 5 seconds"
          onClick={() => dispatch(rewind(DEFAULT_SEEK_MS))}
        >
          ⏮
        </button>
        <button
          type="button"
          className="icon-button icon-button--primary"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => dispatch(setPlaying(!playing))}
        >
          {playing ? '⏸' : '▶'}
        </button>
      </div>

      <div className="control-bar__group control-bar__speeds" role="group" aria-label="Playback speed">
        {PLAYBACK_SPEEDS.map((option) => (
          <button
            key={option}
            type="button"
            className="speed-button"
            aria-pressed={option === speed}
            onClick={() => dispatch(setSpeed(option))}
          >
            {option}×
          </button>
        ))}
      </div>

      <div className="control-bar__scrub">
        <div className="scrubber">
          <div className="scrubber__markers" aria-hidden="true">
            {markers.map((marker) => (
              <span
                key={marker.id}
                className="scrubber__marker"
                data-kind={marker.kind}
                style={{ left: `${marker.left}%` }}
              />
            ))}
          </div>
          <input
            type="range"
            aria-label="Scrubber"
            min={0}
            max={Math.max(0, durationMs)}
            step={100}
            value={Math.min(timeMs, Math.max(0, durationMs))}
            onChange={(event) => dispatch(seek(Number(event.target.value)))}
          />
        </div>
      </div>

      <div className="race-clock">
        <div className="race-clock__time">{formatRaceClock(timeMs)}</div>
        <div className="race-clock__lap">
          LAP {currentLap}/{lapCount}
        </div>
      </div>
    </div>
  )
}
