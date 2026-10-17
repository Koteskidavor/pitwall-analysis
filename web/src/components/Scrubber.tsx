import React from 'react'
import { useAppDispatch } from '../store'
import { seek } from '../playbackSlice'
import { useEngineSnapshot } from '../engineContext'

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export const Scrubber: React.FC = () => {
  const dispatch = useAppDispatch()
  const { timeMs, durationMs } = useEngineSnapshot()
  const max = Math.max(0, durationMs)

  return (
    <div className="scrubber">
      <input
        type="range"
        aria-label="Scrubber"
        min={0}
        max={max}
        step={100}
        value={Math.min(timeMs, max)}
        onChange={(event) => dispatch(seek(Number(event.target.value)))}
      />
      <span>
        {formatClock(timeMs)} / {formatClock(durationMs)}
      </span>
    </div>
  )
}
