import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Track } from '@pitwall/shared'
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

type MapPoint = { x: number; y: number }

const DEFAULT_SECTOR_FRACTIONS = [1 / 3, 2 / 3]

function splitOutline(outline: readonly MapPoint[], fractions: readonly number[]): MapPoint[][] {
  if (outline.length < 3) {
    return [outline.slice(), outline.slice(), outline.slice()]
  }

  const last = outline.length - 1
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
  const first = clamp(Math.round(fractions[0] * last), 1, last - 1)
  const second = clamp(Math.round(fractions[1] * last), first + 1, last)
  return [
    outline.slice(0, first + 1),
    outline.slice(first, second + 1),
    outline.slice(second),
  ]
}

// Point halfway along a sector run, measured by arclength, used to place its
// label beside the track rather than at a vertex.
function midpointOf(points: readonly MapPoint[]): MapPoint {
  if (points.length === 1) return points[0]

  const lengths: number[] = []
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    const length = Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    )
    lengths.push(length)
    total += length
  }
  if (total === 0) return points[0]

  let remaining = total / 2
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index]) {
      const t = lengths[index] === 0 ? 0 : remaining / lengths[index]
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * t,
        y: points[index].y + (points[index + 1].y - points[index].y) * t,
      }
    }
    remaining -= lengths[index]
  }
  return points[points.length - 1]
}

// Exact sector geometry written by the ETL from OpenF1 sector timings. Older
// track files repeat the full outline in each sector, so fall back to a third
// split rather than drawing three overlapping sectors.
function sectorRuns(track: Track): MapPoint[][] {
  const { sector1, sector2, sector3 } = track
  const hasExactSectors =
    sector3 !== undefined &&
    sector1.outer.length >= 2 &&
    sector2.outer.length >= 2 &&
    sector3.outer.length >= 2 &&
    sector1.outer.length < track.outline.length

  if (hasExactSectors) {
    return [sector1.outer, sector2.outer, sector3.outer]
  }
  return splitOutline(track.outline, DEFAULT_SECTOR_FRACTIONS)
}

// The static layer: track outline, exact sector boundaries, sector labels and
// a start/finish marker. Redrawn only when the geometry or viewport changes.
// Ticks use fillRect (no path ops) so the outline stroke stays a single
// moveTo/lineTo run.
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

    context.strokeStyle = '#22303f'
    context.lineWidth = 14
    context.stroke()

    context.strokeStyle = '#46586e'
    context.lineWidth = 3
    context.stroke()
  }

  // Sector boundaries at the exact lap fractions from the timing feed.
  const sectors = sectorRuns(track)
  context.fillStyle = '#8390a3'
  for (const points of sectors.slice(0, 2)) {
    if (points.length === 0) continue
    const boundary = worldToScreen(points[points.length - 1], transform)
    context.fillRect(boundary.x - 3, boundary.y - 3, 6, 6)
  }

  // Label each sector directly beneath its midpoint.
  context.font = `600 10px ${'Inter, system-ui, sans-serif'}`
  context.textAlign = 'center'
  context.fillStyle = '#8390a3'
  sectors.forEach((points, index) => {
    if (points.length === 0) return
    const midpoint = worldToScreen(midpointOf(points), transform)
    context.fillText(`SECTOR ${index + 1}`, midpoint.x, midpoint.y + 16)
  })

  // Start / finish line marker at the first outline point.
  if (outline.length > 0) {
    const start = worldToScreen(outline[0], transform)
    context.fillStyle = '#e9eef5'
    context.fillRect(start.x - 4, start.y - 6, 8, 12)
    context.fillStyle = '#0a0f15'
    context.fillRect(start.x - 4, start.y - 6, 4, 6)
    context.fillRect(start.x, start.y, 4, 6)
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
    const screen = worldToScreen(sample, transform)
    const selected = sample.driverId === selectedDriverId
    const retired = sample.status === DRIVER_STATUS.OUT
    const inPit = sample.status === DRIVER_STATUS.PIT
    const radius = selected ? 8 : 5

    context.globalAlpha = retired ? 0.35 : 1
    context.beginPath()
    context.arc(screen.x, screen.y, radius, 0, Math.PI * 2)
    context.fillStyle = retired ? '#6b7688' : driverColor(sample.driverId)
    context.fill()

    if (inPit) {
      context.lineWidth = 2
      context.strokeStyle = '#4aa3ff'
    } else if (selected) {
      context.lineWidth = 3
      context.strokeStyle = '#e9eef5'
    } else {
      context.lineWidth = 1.5
      context.strokeStyle = 'rgba(255, 255, 255, 0.85)'
    }
    context.stroke()

    if (selected) {
      context.beginPath()
      context.arc(screen.x, screen.y, radius + 4, 0, Math.PI * 2)
      context.lineWidth = 1.5
      context.strokeStyle = 'rgba(233, 238, 245, 0.85)'
      context.stroke()
    }

    context.fillStyle = retired ? '#8390a3' : '#e9eef5'
    context.font = `${selected ? '700' : '600'} 11px ${'Inter, system-ui, sans-serif'}`
    context.textAlign = 'center'
    context.fillText(sample.driverId, screen.x, screen.y - radius - 5)
    context.globalAlpha = 1
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
      style={{ position: 'relative', width: '100%', aspectRatio: `${width} / ${height}` }}
    >
      <canvas
        ref={staticCanvasRef}
        data-testid="track-map-static"
        aria-hidden="true"
        width={width}
        height={height}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      <canvas
        ref={dynamicCanvasRef}
        data-testid="track-map-dynamic"
        role="img"
        aria-label="Track map"
        width={width}
        height={height}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer' }}
        onClick={handleClick}
      />
    </div>
  )
}
