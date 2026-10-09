// Binary decoder for motion and gaps chunks
import { BINARY_LAYOUT, GAPS_LAYOUT } from '../../shared/src/schemas'

// Motion chunk decoder
// Layout per chunk: [driver][step] where step = 60 * 5 = 300 steps at 5 Hz
// Fields per step: progress(Float32), x(Float32), y(Float32), speed(Float32), status(Uint8)
// Total per step: 17 bytes (4+4+4+4+1)

export interface MotionChunk {
  progress: Float32Array  // flat [driverCount * stepCount]
  x: Float32Array         // flat [driverCount * stepCount]
  y: Float32Array         // flat [driverCount * stepCount]
  speed: Float32Array     // flat [driverCount * stepCount]
  status: Uint8Array      // flat [driverCount * stepCount]
}

export function decodeMotionChunk(buffer: ArrayBuffer, driverCount: number, stepCount: number): MotionChunk {
  const expectedBytes = driverCount * stepCount * 17 // 17 bytes per step

  if (buffer.byteLength !== expectedBytes) {
    throw new Error(`Motion chunk size mismatch: expected ${expectedBytes}, got ${buffer.byteLength}`)
  }

  const view = new DataView(buffer)
  const progress = new Float32Array(driverCount * stepCount)
  const x = new Float32Array(driverCount * stepCount)
  const y = new Float32Array(driverCount * stepCount)
  const speed = new Float32Array(driverCount * stepCount)
  const status = new Uint8Array(driverCount * stepCount)

  // Arrays are stored field by field, each as [driver][step]
  // Read sequentially: for each step, read all driver values for that field

  for (let s = 0; s < stepCount; s++) {
    for (let d = 0; d < driverCount; d++) {
      const offset = (d * stepCount + s) * 4

      // progress (Float32 at offset 0 within the step's 17 bytes)
      progress[d * stepCount + s] = view.getFloat32(offset, true)

      // x (Float32 at offset 4 within the step)
      x[d * stepCount + s] = view.getFloat32(offset + 4, true)

      // y (Float32 at offset 8 within the step)
      y[d * stepCount + s] = view.getFloat32(offset + 8, true)

      // speed (Float32 at offset 12 within the step)
      speed[d * stepCount + s] = view.getFloat32(offset + 12, true)

      // status (Uint8 at offset 16 within the step)
      status[d * stepCount + s] = view.getUint8(offset + 16)
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