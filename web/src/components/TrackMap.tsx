import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Track } from '../../../shared/src/schemas'
import { useAppDispatch, useAppSelector } from '../store'
import { selectDriver, selectSelectedDriverId } from '../uiSlice'
import { useEngine } from '../engineContext'
import { DRIVER_STATUS, type MotionSample } from '../engine'
import { driverColor } from '../driverColors'
import {
  createViewTransform,
  findNearestDriver,
  worldToScreen,
  type ViewTransform,
} from '../trackGeometry'

export const DEFAULT_TRACK_WIDTH = 640
export const DEFAULT_TRACK_HEIGHT = 480
export const DRIVER_HIT_RADIUS_PX = 18

export interface TrackMapProps {
  track: Track
  width?: number
  height?: number
  hitRadiusPx?: number
}

// The static layer: track outline and start/finish marker. Redrawn only when the
// geometry or viewport changes.
function drawStaticLayer(
  canvas: HTMLCanvasElement | null,
  track: Track,
  transform: ViewTransform,
): void {
  const context = canvas?.getContext('2d')
  if (!canvas || !context) return

  context.clearRect(0, 0, canvas.width, canvas.height)

  const outline = track.outline
  if (outline.length > 0) {
    context.beginPath()
    outline.forEach((point, index) => {
      const screen = worldToScreen(point, transform)
      if (index === 0) context.moveTo(screen.x, screen.y)
      else context.lineTo(screen.x, screen.y)
    })
    context.closePath()

    context.lineJoin = 'round'
    context.lineCap = 'round'

    context.strokeStyle = '#cbd5e1'
    context.lineWidth = 12
    context.stroke()

    context.strokeStyle = '#475569'
    context.lineWidth = 3
    context.stroke()
  }

  if (outline.length > 0) {
    const start = worldToScreen(outline[0], transform)
    context.fillStyle = '#ffffff'
    context.strokeStyle = '#111827'
    context.lineWidth = 2
    context.beginPath()
    context.arc(start.x, start.y, 5, 0, Math.PI * 2)
    context.fill()
    context.stroke()
  }
}

// The dynamic layer: one marker per driver, cleared and redrawn for every frame.
function drawDynamicLayer(
  canvas: HTMLCanvasElement | null,
  samples: readonly MotionSample[],
  transform: ViewTransform,
  selectedDriverId: string | null,
): void {
  const context = canvas?.getContext('2d')
  if (!canvas || !context) return

  context.clearRect(0, 0, canvas.width, canvas.height)

  for (const sample of samples) {
    if (sample.status === DRIVER_STATUS.OUT) continue

    const screen = worldToScreen(sample, transform)
    const selected = sample.driverId === selectedDriverId
    const radius = selected ? 8 : 5

    context.beginPath()
    context.arc(screen.x, screen.y, radius, 0, Math.PI * 2)
    context.fillStyle = driverColor(sample.driverId)
    context.fill()
    context.lineWidth = selected ? 3 : 1.5
    context.strokeStyle = selected ? '#111827' : 'rgba(255, 255, 255, 0.9)'
    context.stroke()

    context.fillStyle = '#111827'
    context.font = `${selected ? '700' : '600'} 11px sans-serif`
    context.textAlign = 'center'
    context.fillText(sample.driverId, screen.x, screen.y - radius - 4)
  }
}

export const TrackMap: React.FC<TrackMapProps> = ({
  track,
  width = DEFAULT_TRACK_WIDTH,
  height = DEFAULT_TRACK_HEIGHT,
  hitRadiusPx = DRIVER_HIT_RADIUS_PX,
}) => {
  const dispatch = useAppDispatch()
  const selectedDriverId = useAppSelector(selectSelectedDriverId)
  const engine = useEngine()

  const staticCanvasRef = useRef<HTMLCanvasElement>(null)
  const dynamicCanvasRef = useRef<HTMLCanvasElement>(null)

  const transform = useMemo(
    () => createViewTransform(track.outline, width, height),
    [track, width, height],
  )

  useEffect(() => {
    drawStaticLayer(staticCanvasRef.current, track, transform)
  }, [track, transform])

  // Draw imperatively on every engine frame instead of re-rendering React at
  // 60 fps. Seek and chunk-load publishes both arrive.
  useEffect(() => {
    const renderFrame = () => {
      drawDynamicLayer(
        dynamicCanvasRef.current,
        engine.getSnapshot().samples,
        transform,
        selectedDriverId,
      )
    }

    renderFrame()
    return engine.subscribe(renderFrame)
  }, [engine, transform, selectedDriverId])

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }
      const samples = engine.getSnapshot().samples
      dispatch(selectDriver(findNearestDriver(samples, point, transform, hitRadiusPx)))
    },
    [dispatch, engine, transform, hitRadiusPx],
  )

  return (
    <div
      className="track-map"
      data-testid="track-map"
      data-selected-driver={selectedDriverId ?? ''}
      style={{ position: 'relative', width, height }}
    >
      <canvas
        ref={staticCanvasRef}
        data-testid="track-map-static"
        aria-hidden="true"
        width={width}
        height={height}
        style={{ position: 'absolute', inset: 0 }}
      />
      <canvas
        ref={dynamicCanvasRef}
        data-testid="track-map-dynamic"
        role="img"
        aria-label="Track map"
        width={width}
        height={height}
        style={{ position: 'absolute', inset: 0, cursor: 'pointer' }}
        onClick={handleClick}
      />
    </div>
  )
}
