// Binary decoder for motion and gaps chunks
// Layout constants
const MOTION_STEPS_PER_CHUNK = 60 * 5 // 5 Hz * 60 seconds
const MOTION_BYTES_PER_STEP = 17 // 4+4+4+4+1 (Float32 x4 + Uint8)

// Motion chunk decoder
// Layout per chunk: field planes stored in order progress, x, y, speed, status.
// Each Float32 plane holds driverCount * stepCount values in [driver][step] order
// (index = driver * stepCount + step). The status plane is Uint8 and follows the
// four Float32 planes. Keeping the Float32 planes first preserves 4-byte alignment.
// Total per chunk: driverCount * stepCount * 17 bytes (4+4+4+4+1 per step).

export interface MotionChunk {
  progress: Float32Array  // flat [driverCount * stepCount], [driver][step] order
  x: Float32Array         // flat [driverCount * stepCount], [driver][step] order
  y: Float32Array         // flat [driverCount * stepCount], [driver][step] order
  speed: Float32Array     // flat [driverCount * stepCount], [driver][step] order
  status: Uint8Array      // flat [driverCount * stepCount], [driver][step] order
}

export function decodeMotionChunk(buffer: ArrayBuffer, driverCount: number, stepCount: number): MotionChunk {
  const expectedBytes = driverCount * stepCount * MOTION_BYTES_PER_STEP

  if (buffer.byteLength !== expectedBytes) {
    throw new Error(`Motion chunk size mismatch: expected ${expectedBytes}, got ${buffer.byteLength}`)
  }

  const view = new DataView(buffer)
  const elementCount = driverCount * stepCount
  const progress = new Float32Array(elementCount)
  const x = new Float32Array(elementCount)
  const y = new Float32Array(elementCount)
  const speed = new Float32Array(elementCount)
  const status = new Uint8Array(elementCount)

  // Byte offset where each plane begins.
  const progressBase = 0
  const xBase = elementCount * 4
  const yBase = 2 * elementCount * 4
  const speedBase = 3 * elementCount * 4
  const statusBase = 4 * elementCount * 4

  for (let d = 0; d < driverCount; d++) {
    for (let s = 0; s < stepCount; s++) {
      const planeIndex = d * stepCount + s
      const byteIndex = planeIndex * 4

      progress[planeIndex] = view.getFloat32(progressBase + byteIndex, true)
      x[planeIndex] = view.getFloat32(xBase + byteIndex, true)
      y[planeIndex] = view.getFloat32(yBase + byteIndex, true)
      speed[planeIndex] = view.getFloat32(speedBase + byteIndex, true)
      status[planeIndex] = view.getUint8(statusBase + planeIndex)
    }
  }

  return {
    progress,
    x,
    y,
    speed,
    status,
  }
}

// Gaps chunk decoder
// Layout: [driver][lap][checkpoint] where checkpoint = 100 evenly spaced points
// Each entry is Uint32 crossing time in ms. 0xFFFFFFFF means not crossed.

export interface GapsData {
  crossingTimes: Uint32Array  // flat [driverCount * lapCount * checkpointCount]
}

export function decodeGapsChunk(buffer: ArrayBuffer, driverCount: number, lapCount: number, checkpointCount: number): GapsData {
  const expectedBytes = driverCount * lapCount * checkpointCount * 4 // 4 bytes per Uint32

  if (buffer.byteLength !== expectedBytes) {
    throw new Error(`Gaps chunk size mismatch: expected ${expectedBytes}, got ${buffer.byteLength}`)
  }

  const view = new DataView(buffer)
  const crossingTimes = new Uint32Array(driverCount * lapCount * checkpointCount)

  for (let i = 0; i < crossingTimes.length; i++) {
    crossingTimes[i] = view.getUint32(i * 4, true)
  }

  return { crossingTimes }
}

// Validate that progress is non-decreasing per driver
export function validateProgressNonDecreasing(progress: Float32Array, driverCount: number, stepCount: number): boolean {
  for (let d = 0; d < driverCount; d++) {
    let last = -1
    for (let s = 0; s < stepCount; s++) {
      const p = progress[d * stepCount + s]
      if (p < last) return false
      if (p > last) last = p
    }
  }
  return true
}

// Validate that gap times are monotonic per driver
export function validateGapsMonotonic(crossingTimes: Uint32Array, driverCount: number, lapCount: number, checkpointCount: number): boolean {
  for (let d = 0; d < driverCount; d++) {
    for (let lap = 0; lap < lapCount; lap++) {
      let last = -1
      for (let c = 0; c < checkpointCount; c++) {
        const t = crossingTimes[d * lapCount * checkpointCount + lap * checkpointCount + c]
        if (t === 0xFFFFFFFF) continue // not crossed
        if (t <= last) return false
        last = t
      }
    }
  }
  return true
}
