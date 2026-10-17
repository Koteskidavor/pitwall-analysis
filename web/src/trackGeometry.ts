import { DRIVER_STATUS, type MotionSample } from './engine'

// Pure geometry for the track map. Keeping the world <-> screen mapping and the
// hit-testing out of the React component makes both the rendering and the
// selection logic unit-testable without a canvas.

export interface Point {
  x: number
  y: number
}

export interface WorldBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface ViewTransform {
  scale: number
  offsetX: number
  offsetY: number
  minX: number
  minY: number
  worldWidth: number
  worldHeight: number
  flipY: boolean
}

export interface ViewTransformOptions {
  padding?: number
  flipY?: boolean
}

const DEFAULT_PADDING = 16

export function worldBounds(points: readonly Point[]): WorldBounds {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }

  return { minX, minY, maxX, maxY }
}

// Fit the world points into a width x height viewport, preserving aspect ratio.
// Source coordinates are y-up (telemetry), canvas coordinates are y-down, so the
// vertical axis is flipped by default.
export function createViewTransform(
  points: readonly Point[],
  width: number,
  height: number,
  options: ViewTransformOptions = {},
): ViewTransform {
  const padding = options.padding ?? DEFAULT_PADDING
  const flipY = options.flipY ?? true
  const bounds = worldBounds(points)

  const worldWidth = Math.max(bounds.maxX - bounds.minX, Number.EPSILON)
  const worldHeight = Math.max(bounds.maxY - bounds.minY, Number.EPSILON)
  const usableWidth = Math.max(width - padding * 2, 1)
  const usableHeight = Math.max(height - padding * 2, 1)
  const scale = Math.min(usableWidth / worldWidth, usableHeight / worldHeight)

  return {
    scale,
    offsetX: (width - worldWidth * scale) / 2,
    offsetY: (height - worldHeight * scale) / 2,
    minX: bounds.minX,
    minY: bounds.minY,
    worldWidth,
    worldHeight,
    flipY,
  }
}

export function worldToScreen(point: Point, transform: ViewTransform): Point {
  const x = transform.offsetX + (point.x - transform.minX) * transform.scale
  const unscaledY = (point.y - transform.minY) * transform.scale
  const y =
    transform.offsetY +
    (transform.flipY ? transform.worldHeight * transform.scale - unscaledY : unscaledY)
  return { x, y }
}

export function screenToWorld(point: Point, transform: ViewTransform): Point {
  const x = (point.x - transform.offsetX) / transform.scale + transform.minX
  const unscaledY =
    transform.flipY
      ? (transform.worldHeight * transform.scale - (point.y - transform.offsetY)) / transform.scale
      : (point.y - transform.offsetY) / transform.scale
  return { x, y: unscaledY + transform.minY }
}

// Returns the id of the closest visible driver within maxDistancePx, or null.
// Retired cars (status OUT) are not on track and are skipped.
export function findNearestDriver(
  samples: readonly MotionSample[],
  point: Point,
  transform: ViewTransform,
  maxDistancePx: number,
): string | null {
  let nearestId: string | null = null
  let nearestDistance = maxDistancePx

  for (const sample of samples) {
    if (sample.status === DRIVER_STATUS.OUT) continue

    const screen = worldToScreen(sample, transform)
    const distance = Math.hypot(screen.x - point.x, screen.y - point.y)
    if (distance <= nearestDistance) {
      nearestDistance = distance
      nearestId = sample.driverId
    }
  }

  return nearestId
}
