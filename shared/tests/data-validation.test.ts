import { describe, it, expect } from 'vitest'
import { validateManifest, validateTrack, validateSession, type Manifest, type Track, type Session } from '../src/schemas'

describe('CP1: Shared contract - zod schemas', () => {
  describe('manifestSchema', () => {
    it('validates a valid manifest', () => {
      const valid = {
        schemaVersion: '1.0.0',
        sampleHz: 5,
        chunkSeconds: 60,
        driverOrder: ['DRV1', 'DRV2'],
        chunkCount: 3,
        trackLengthM: 3000,
        durationMs: 3600000,
        availableLayers: ['motion', 'gaps'],
      }
      const result = validateManifest(valid)
      expect(result.schemaVersion).toBe('1.0.0')
      expect(result.sampleHz).toBe(5)
    })

    it('rejects missing fields', () => {
      const invalid = {
        schemaVersion: '1.0.0',
        sampleHz: 5,
        // missing chunkSeconds
      }
      expect(() => validateManifest(invalid)).toThrow()
    })
  })

  describe('trackSchema', () => {
    it('validates a valid track', () => {
      const valid = {
        outline: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
        sector1: { outer: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }], inner: null },
        sector2: { outer: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }], inner: null },
        bounds: { x: 0, y: 0 },
      }
      const result = validateTrack(valid)
      expect(result.outline.length).toBe(4)
    })

    it('rejects invalid track points', () => {
      expect(() =>
        validateTrack({
          outline: [{ x: 'bad', y: 0 }],
          sector1: { outer: [], inner: null },
          sector2: { outer: [], inner: null },
          bounds: { x: 0, y: 0 },
        })
      ).toThrow()
    })
  })

  describe('sessionSchema', () => {
    it('validates a valid session', () => {
      const valid = {
        id: '2019_1_ monaco',
        year: 2019,
        round: 1,
        type: 'race',
        name: 'Monaco Grand Prix',
        track: 'monaco',
        schema_version: '1.0.0',
        status: 'ready',
        processed_at: null,
      }
      const result = validateSession(valid)
      expect(result.year).toBe(2019)
    })

    it('rejects invalid status', () => {
      expect(() =>
        validateSession({
          ...{
            id: 'test',
            year: 2019,
            round: 1,
            type: 'race',
            name: 'Test',
            track: 'test',
            schema_version: '1.0.0',
            status: 'invalid',
            processed_at: null,
          }
        })
      ).toThrow()
    })
  })
})