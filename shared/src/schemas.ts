// Shared zod schemas for pitwall-analytics
import { z } from 'zod'

// ===== SQLite row types =====

export const sessionSchema = z.object({
  id: z.string(),
  year: z.number(),
  round: z.number(),
  type: z.string(),
  name: z.string(),
  track: z.string(),
  schema_version: z.string(),
  status: z.enum(['ready', 'failed']),
  processed_at: z.string().nullable(),
})

export type Session = z.infer<typeof sessionSchema>

export const driverSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  nationality: z.string().nullable(),
})

export type Driver = z.infer<typeof driverSchema>

export const lapSchema = z.object({
  lap_time_ms: z.number(),
  lap_start_ms: z.number(),
  lap_end_ms: z.number(),
  s1_ms: z.number().nullable(),
  s2_ms: z.number().nullable(),
  s3_ms: z.number().nullable(),
  position: z.number().nullable(),
  compound: z.string().nullable(),
  tyre_age: z.number(),
  is_accurate: z.union([z.boolean(), z.number()]).transform(val => val === 1 || val === true),
  is_pit_in: z.union([z.boolean(), z.number()]).default(false).transform(val => val === 1 || val === true),
  is_pit_out: z.union([z.boolean(), z.number()]).default(false).transform(val => val === 1 || val === true),
  driverId: z.string(),
  lap: z.number(),
})

export type Lap = z.infer<typeof lapSchema>

export const stintSchema = z.object({
  driverId: z.string(),
  lapStart: z.number(),
  lapEnd: z.number(),
  compound: z.string(),
  tyreAgeAtStart: z.number(),
})

export type Stint = z.infer<typeof stintSchema>

export const pitStopSchema = z.object({
  driverId: z.string(),
  lap: z.number(),
  time_ms: z.number(),
  duration_ms: z.number(),
})

export type PitStop = z.infer<typeof pitStopSchema>

export const resultSchema = z.object({
  driverId: z.string(),
  position: z.number(),
  time_ms: z.number().nullable(),
  gap_ms: z.number().nullable(),
  points: z.number().default(0),
})

export type Result = z.infer<typeof resultSchema>

export const eventSchema = z.object({
  id: z.string(),
  timestamp_ms: z.number(),
  type: z.string(),
  driverId: z.string().nullable(),
  message: z.string().nullable(),
})

export type Event = z.infer<typeof eventSchema>

// ===== Manifest schema =====

export const manifestSchema = z.object({
  schemaVersion: z.string(),
  sampleHz: z.number(),
  chunkSeconds: z.number(),
  driverOrder: z.array(z.string()),
  chunkCount: z.number(),
  trackLengthM: z.number(),
  durationMs: z.number(),
  availableLayers: z.array(z.string()),
})

export type Manifest = z.infer<typeof manifestSchema>

// ===== Track schema =====

export const trackPointSchema = z.object({
  x: z.number(),
  y: z.number(),
})

export type TrackPoint = z.infer<typeof trackPointSchema>

export const trackBoundarySchema = z.object({
  outer: z.array(trackPointSchema),
  inner: z.array(trackPointSchema).nullable(),
})

export type TrackBoundary = z.infer<typeof trackBoundarySchema>

export const trackSchema = z.object({
  outline: z.array(trackPointSchema),
  sector1: trackBoundarySchema,
  sector2: trackBoundarySchema,
  bounds: z.object({ x: z.number(), y: z.number() }),
})

export type Track = z.infer<typeof trackSchema>

// ===== Binary layout constants =====

export const BINARY_LAYOUT = {
  // motion.bin: per chunk per driver: progress(Float32), x(Float32), y(Float32), speed(Float32), status(Uint8)
  motionChunkPerDriver: {
    progress: 4,   // Float32
    x: 4,          // Float32
    y: 4,          // Float32
    speed: 4,      // Float32
    status: 1,     // Uint8
  },
  totalBytesPerStep: 17, // 4+4+4+4+1
  stepsPerChunk: 60 * 5, // 5 Hz * 60 seconds
}

export const GAPS_LAYOUT = {
  // gaps.bin: per driver per lap per checkpoint(100): Uint32 crossing time in ms
  // 0xFFFFFFFF means not crossed
  entrySize: 4, // Uint32
  checkpointsPerLap: 100,
}

// ===== API response schemas =====

export const driverResultSchema = z.object({
  driverId: z.string(),
  code: z.string(),
  name: z.string(),
  position: z.number(),
  lapsCompleted: z.number(),
  totalTimeMs: z.number(),
})

export type DriverResult = z.infer<typeof driverResultSchema>

export const lapDataSchema = z.object({
  driverId: z.string(),
  laps: z.array(lapSchema),
})

export type LapData = z.infer<typeof lapDataSchema>

export const sessionApiResponseSchema = manifestSchema.extend({
  drivers: z.array(driverSchema),
  results: z.array(resultSchema),
})

export type SessionApiResponse = z.infer<typeof sessionApiResponseSchema>

// ===== Validation helpers =====

export function validateManifest(data: unknown): Manifest {
  return manifestSchema.parse(data)
}

export function validateTrack(data: unknown): Track {
  return trackSchema.parse(data)
}

export function validateSession(data: unknown): Session {
  return sessionSchema.parse(data)
}