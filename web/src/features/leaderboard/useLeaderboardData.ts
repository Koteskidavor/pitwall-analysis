import { useMemo } from 'react'
import type { Event, Lap, Manifest, PitStop, Stint } from '@pitwall/shared'
import {
  useGetEventsQuery,
  useGetGapsQuery,
  useGetLapsQuery,
  useGetPitStopsQuery,
  useGetStintsQuery,
} from '../../apiSlice'
import { buildGapTable, type GapTable } from './gaps'

export interface LeaderboardData {
  laps: Lap[]
  stints: Stint[]
  pitStops: PitStop[]
  events: Event[]
  gapTable: GapTable | null
  isLoading: boolean
  isError: boolean
}

// Gathers everything the leaderboard needs for one session and decodes the
// gaps.bin payload once per manifest. The playhead stays in the engine; this
// hook only owns the static per-session tables.
export function useLeaderboardData(
  sessionId: string | null,
  manifest: Manifest | null,
): LeaderboardData {
  const enabled = Boolean(sessionId)
  const id = sessionId ?? ''

  const lapsQuery = useGetLapsQuery(id, { skip: !enabled })
  const stintsQuery = useGetStintsQuery(id, { skip: !enabled })
  const pitStopsQuery = useGetPitStopsQuery(id, { skip: !enabled })
  const eventsQuery = useGetEventsQuery(id, { skip: !enabled })

  const lapCount = manifest?.lapCount
  const canDecodeGaps = enabled && lapCount !== undefined && (manifest?.driverOrder.length ?? 0) > 0
  const gapsQuery = useGetGapsQuery(id, { skip: !canDecodeGaps })

  const gapTable = useMemo(() => {
    if (!gapsQuery.data || lapCount === undefined || !manifest) return null
    try {
      return buildGapTable(gapsQuery.data, manifest.driverOrder, lapCount)
    } catch {
      // A malformed payload must not take the whole race view down.
      return null
    }
  }, [gapsQuery.data, lapCount, manifest])

  return {
    laps: lapsQuery.data ?? [],
    stints: stintsQuery.data ?? [],
    pitStops: pitStopsQuery.data ?? [],
    events: eventsQuery.data ?? [],
    gapTable,
    isLoading:
      lapsQuery.isLoading ||
      stintsQuery.isLoading ||
      pitStopsQuery.isLoading ||
      eventsQuery.isLoading,
    isError:
      lapsQuery.isError ||
      stintsQuery.isError ||
      pitStopsQuery.isError ||
      eventsQuery.isError,
  }
}
