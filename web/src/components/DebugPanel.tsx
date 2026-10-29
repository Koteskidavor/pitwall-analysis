import React from 'react'
import type { MotionSample } from '../engine'
import { formatRaceClock } from '../format'

export interface DebugPanelProps {
  timeMs: number
  loadedChunks: number
  cacheCapacity: number
  sample: MotionSample | null
}

// Dev-only readout. Guarded by import.meta.env.DEV at the call site so Vite
// tree-shakes it out of production builds entirely.
export const DebugPanel: React.FC<DebugPanelProps> = ({
  timeMs,
  loadedChunks,
  cacheCapacity,
  sample,
}) => {
  return (
    <section className="debug-panel" data-testid="debug-panel">
      <span className="debug-panel__label">Dev only</span>
      <dl>
        <dt>Playhead</dt>
        <dd>{formatRaceClock(timeMs)}</dd>
        <dt>Loaded chunks</dt>
        <dd>
          {loadedChunks} / {cacheCapacity}
        </dd>
        <dt>Selected sample</dt>
        <dd>{sample ? sample.driverId : '—'}</dd>
        {sample && (
          <>
            <dt>progress</dt>
            <dd>{sample.progress.toFixed(2)}</dd>
            <dt>x / y</dt>
            <dd>
              {sample.x.toFixed(1)} / {sample.y.toFixed(1)}
            </dd>
            <dt>speed</dt>
            <dd>{sample.speed.toFixed(1)} km/h</dd>
          </>
        )}
      </dl>
    </section>
  )
}
