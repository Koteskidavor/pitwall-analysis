import React, { useMemo } from 'react'

export interface TrackThumbnailProps {
  points: ReadonlyArray<{ x: number; y: number }>
  width?: number
  height?: number
  color?: string
  strokeWidth?: number
}

// Small, self-contained SVG outline used on the race cards. Points are fitted
// into the box with the same y-flip the big canvas map uses, so the thumbnail
// matches the full map's orientation.
export const TrackThumbnail: React.FC<TrackThumbnailProps> = ({
  points,
  width = 80,
  height = 54,
  color = 'currentColor',
  strokeWidth = 2.5,
}) => {
  const path = useMemo(() => {
    if (points.length < 2) return ''

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const point of points) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }

    const worldWidth = Math.max(maxX - minX, Number.EPSILON)
    const worldHeight = Math.max(maxY - minY, Number.EPSILON)
    const pad = strokeWidth + 1
    const scale = Math.min((width - pad * 2) / worldWidth, (height - pad * 2) / worldHeight)
    const offsetX = (width - worldWidth * scale) / 2
    const offsetY = (height - worldHeight * scale) / 2

    return points
      .map((point, index) => {
        const x = offsetX + (point.x - minX) * scale
        const y = offsetY + (worldHeight - (point.y - minY)) * scale
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
      })
      .join(' ')
  }, [points, width, height, strokeWidth])

  if (!path) {
    return <svg width={width} height={height} aria-hidden="true" />
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={`${path} Z`}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
