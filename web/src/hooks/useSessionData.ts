import { useMemo } from 'react'
import type {
  Driver,
  Event,
  Lap,
  Manifest,
  PitStop,
  Result,
  Stint,
  Track,
} from '@pitwall/shared'
import {
  useGetDriversQuery,
  useGetEventsQuery,
  useGetGapsQuery,
  useGetLapsQuery,
  useGetManifestQuery,
  useGetPitStopsQuery,
  useGetResultsQuery,
  useGetStintsQuery,
  useGetTrackQuery,
} from '../apiSlice'
import { buildGapTable, type GapTable } from '../features/leaderboard'

export interface SessionData {
  manifest: Manifest | null
  track: Track | null
  drivers: Driver[]
  results: Result[]
  laps: Lap[]
  stints: Stint[]
  pitStops: PitStop[]
  events: Event[]
  gapTable: GapTable | null
  isLoading: boolean
  isError: boolean
}

// One hook per session that fans out to every table the race view needs and
// decodes gaps.bin once per manifest. The playhead stays in the engine; this
// only owns static per-session data.
export function useSessionData(sessionId: string | null): SessionData {
  const enabled = Boolean(sessionId)
  const id = sessionId ?? ''

  const manifest = useGetManifestQuery(id, { skip: !enabled })
  const track = useGetTrackQuery(id, { skip: !enabled })
  const drivers = useGetDriversQuery(id, { skip: !enabled })
  const results = useGetResultsQuery(id, { skip: !enabled })
  const laps = useGetLapsQuery(id, { skip: !enabled })
  const stints = useGetStintsQuery(id, { skip: !enabled })
  const pitStops = useGetPitStopsQuery(id, { skip: !enabled })
  const events = useGetEventsQuery(id, { skip: !enabled })

  const lapCount = manifest.data?.lapCount
  // gaps.bin is the fallback when a driver's lap timing is missing (for
  // example, a leader whose laps were not recorded). Lap timing is preferred
  // whenever it is available, but keeping the fallback loaded means gaps do
  // not disappear when the leader happens to lack timing data.
  const canDecodeGaps =
    enabled &&
    lapCount !== undefined &&
    (manifest.data?.driverOrder.length ?? 0) > 0
  const gaps = useGetGapsQuery(id, { skip: !canDecodeGaps })

  const gapTable = useMemo(() => {
    if (!gaps.data || lapCount === undefined || !manifest.data) return null
    try {
      return buildGapTable(gaps.data, manifest.data.driverOrder, lapCount)
    } catch {
      // A malformed payload must not take the whole race view down.
      return null
    }
  }, [gaps.data, lapCount, manifest.data])

  return {
    manifest: manifest.data ?? null,
    track: track.data ?? null,
    drivers: drivers.data ?? [],
    results: results.data ?? [],
    laps: laps.data ?? [],
    stints: stints.data ?? [],
    pitStops: pitStops.data ?? [],
    events: events.data ?? [],
    gapTable,
    isLoading:
      manifest.isLoading ||
      track.isLoading ||
      drivers.isLoading ||
      results.isLoading ||
      laps.isLoading ||
      stints.isLoading ||
      pitStops.isLoading ||
      events.isLoading,
    isError:
      manifest.isError ||
      track.isError ||
      drivers.isError ||
      results.isError ||
      laps.isError ||
      stints.isError ||
      pitStops.isError ||
      events.isError,
  }
}
