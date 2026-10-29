import React, { useEffect, useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import type { Driver, Lap, Result } from '@pitwall/shared'
import { useGetSessionQuery } from '../apiSlice'
import { useSessionData } from '../hooks/useSessionData'
import { useAppDispatch, useAppSelector, setPlaybackEngine } from '../store'
import { selectDriver, selectSelectedDriverId } from '../uiSlice'
import { createNoopPlaybackEngine } from '../playbackMiddleware'
import { RaceEngine, type EngineSnapshot } from '../engine'
import { EngineProvider, type EngineSnapshotSource, useEngineSnapshot } from '../engineContext'
import { usePlaybackKeyboard } from '../usePlaybackKeyboard'
import { TopBar } from '../components/TopBar'
import { RaceHeader } from '../components/RaceHeader'
import { DriverStrip } from '../components/DriverStrip'
import { TrackMap } from '../components/TrackMap'
import { ResultsTable } from '../components/ResultsTable'
import { LapTable } from '../components/LapTable'
import { DebugPanel } from '../components/DebugPanel'
import { ControlBar } from '../components/ControlBar'
import { Leaderboard } from '../features/leaderboard/Leaderboard'
import { prettifyTrack } from '../format'

const EMPTY_SNAPSHOT: EngineSnapshot = {
  timeMs: 0,
  durationMs: 0,
  speed: 1,
  playing: false,
  ended: false,
  ready: false,
  samples: [],
}

const emptySource: EngineSnapshotSource = {
  getSnapshot: () => EMPTY_SNAPSHOT,
  subscribe: () => () => {},
}

function gridOrder(results: Result[], fallback: string[]): string[] {
  if (results.length > 0) {
    return [...results]
      .sort(
        (a, b) =>
          (a.grid_position ?? a.position ?? Number.MAX_SAFE_INTEGER) -
          (b.grid_position ?? b.position ?? Number.MAX_SAFE_INTEGER),
      )
      .map((result) => result.driverId)
  }
  return fallback
}

function namesOf(drivers: Driver[]): Record<string, string> {
  return Object.fromEntries(drivers.map((driver) => [driver.code, driver.name]))
}

function raceLapAt(laps: Lap[], timeMs: number, lapCount: number): number {
  let completed = 0
  for (const lap of laps) {
    if (lap.lap_end_ms > 0 && lap.lap_end_ms <= timeMs) {
      completed = Math.max(completed, lap.lap)
    }
  }
  return Math.min(Math.max(lapCount, 1), completed + 1)
}

function driverLapAt(laps: Lap[], timeMs: number): number | null {
  if (laps.length === 0) return null
  let completed = 0
  for (const lap of laps) {
    if (lap.lap_end_ms > 0 && lap.lap_end_ms <= timeMs) completed = Math.max(completed, lap.lap)
  }
  return completed + 1
}

interface RaceViewProps {
  session: NonNullable<ReturnType<typeof useGetSessionQuery>['data']>
  data: ReturnType<typeof useSessionData>
  engine: RaceEngine | null
}

const RaceView: React.FC<RaceViewProps> = ({ session, data, engine }) => {
  const dispatch = useAppDispatch()
  const [searchParams, setParams] = useSearchParams()
  const selectedDriverId = useAppSelector(selectSelectedDriverId)
  const { timeMs } = useEngineSnapshot()

  usePlaybackKeyboard()

  const tier: 'full' | 'results' = session.dataTier ?? 'results'
  const lapCount = useMemo(() => {
    if (data.manifest?.lapCount) return data.manifest.lapCount
    return data.laps.reduce((max, lap) => Math.max(max, lap.lap), 0)
  }, [data.manifest, data.laps])

  const order = useMemo(
    () => gridOrder(data.results, data.manifest?.driverOrder ?? []),
    [data.results, data.manifest],
  )
  const names = useMemo(() => namesOf(data.drivers), [data.drivers])

  const selectedLaps = useMemo(
    () => data.laps.filter((lap) => lap.driverId === selectedDriverId),
    [data.laps, selectedDriverId],
  )

  const flaggedLaps = useMemo(
    () => data.laps.filter((lap) => !lap.is_accurate).length,
    [data.laps],
  )

  const currentDriverLap = tier === 'full' ? driverLapAt(selectedLaps, timeMs) : null
  const currentRaceLap = raceLapAt(data.laps, timeMs, lapCount)

  const sample = useMemo(
    () => engine?.getSnapshot().samples.find((entry) => entry.driverId === selectedDriverId) ?? null,
    [engine, selectedDriverId, timeMs],
  )

  // Selection is the single source of truth in Redux; the URL mirrors it so a
  // view with ?driver=VER can be linked.
  useEffect(() => {
    const urlDriver = searchParams.get('driver')
    if (urlDriver) dispatch(selectDriver(urlDriver))
  }, [])

  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (selectedDriverId) next.set('driver', selectedDriverId)
        else next.delete('driver')
        return next
      },
      { replace: true },
    )
  }, [selectedDriverId])

  return (
    <>
      <TopBar />
      <main className="page page--race">
        <RaceHeader
          year={session.year}
          round={session.round}
          type={session.type}
          name={session.name}
          circuit={prettifyTrack(session.track)}
          date={session.session_date}
          schemaVersion={session.schema_version}
          tier={tier}
          flaggedLaps={flaggedLaps}
        />

        <DriverStrip
          order={order}
          names={names}
          selectedDriverId={selectedDriverId}
          onSelect={(driverId) => dispatch(selectDriver(driverId))}
        />

        {tier === 'full' ? (
          <div className="race-layout">
            <div className="race-main">
              {data.track ? (
                <div className="track-map-wrap">
                  <TrackMap track={data.track} />
                  <div className="track-legend">
                    <span>Click a car or chip to focus a driver</span>
                    <span>·</span>
                    <span>PIT cars outlined blue</span>
                  </div>
                </div>
              ) : (
                <div className="state-card">Track geometry unavailable</div>
              )}

              <div className="strategy-slot">Strategy &amp; stints — coming soon</div>

              <ResultsTable
                results={data.results}
                names={names}
                selectedDriverId={selectedDriverId}
                onSelect={(driverId) => dispatch(selectDriver(driverId))}
              />

              <LapTable
                driverId={selectedDriverId}
                laps={selectedLaps}
                currentLap={currentDriverLap}
              />
            </div>

            <aside className="race-side">
              <Leaderboard
                laps={data.laps}
                stints={data.stints}
                pitStops={data.pitStops}
                gapTable={data.gapTable}
                driverOrder={order}
                results={data.results}
              />
              {import.meta.env.DEV && (
                <DebugPanel
                  timeMs={timeMs}
                  loadedChunks={engine?.getLoadedChunkIndices().length ?? 0}
                  cacheCapacity={8}
                  sample={sample}
                />
              )}
            </aside>
          </div>
        ) : (
          <div className="race-main" style={{ marginTop: 16 }}>
            <div className="state-card">
              Replay is not available for this session — only the final classification was
              processed.
            </div>
            <ResultsTable
              results={data.results}
              names={names}
              selectedDriverId={selectedDriverId}
              onSelect={(driverId) => dispatch(selectDriver(driverId))}
            />
            <LapTable driverId={selectedDriverId} laps={selectedLaps} currentLap={null} />
          </div>
        )}
      </main>

      {tier === 'full' && engine && (
        <ControlBar events={data.events} lapCount={lapCount} currentLap={currentRaceLap} />
      )}
    </>
  )
}

export const RacePage: React.FC = () => {
  const { sessionId = '' } = useParams()
  const {
    data: session,
    isLoading: sessionLoading,
    isError: sessionError,
    refetch,
  } = useGetSessionQuery(sessionId, { skip: !sessionId })
  const data = useSessionData(sessionId || null)

  const tier = session?.dataTier ?? 'results'

  const engine = useMemo(() => {
    if (tier !== 'full' || !data.manifest || !sessionId) return null
    const loadChunk = (index: number): Promise<ArrayBuffer> =>
      fetch(`/api/sessions/${sessionId}/binary/motion/${index}`).then((response) => {
        if (!response.ok) throw new Error(`motion chunk ${index} failed`)
        return response.arrayBuffer()
      })
    return new RaceEngine({ manifest: data.manifest, loadChunk })
  }, [tier, data.manifest, sessionId])

  // Attach the engine to the Redux playback bridge and drive it from a single
  // requestAnimationFrame loop.
  useEffect(() => {
    if (!engine) return
    setPlaybackEngine(engine)
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      engine.tick(now - last)
      last = now
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      setPlaybackEngine(createNoopPlaybackEngine())
    }
  }, [engine])

  if (!sessionId) {
    return (
      <>
        <TopBar />
        <main className="page">
          <div className="state-card state-card--error">No session specified.</div>
        </main>
      </>
    )
  }

  if (sessionLoading) {
    return (
      <>
        <TopBar />
        <main className="page page--race">
          <div className="skeleton" style={{ height: 140 }} />
          <div className="skeleton" style={{ height: 72, marginTop: 16 }} />
        </main>
      </>
    )
  }

  if (sessionError || !session) {
    return (
      <>
        <TopBar />
        <main className="page">
          <div className="state-card state-card--error">
            <h2>Could not load this race</h2>
            <p>The API did not return the session.</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button type="button" className="button" onClick={() => refetch()}>
                Retry
              </button>
              <Link className="button button--ghost" to="/">
                Back to races
              </Link>
            </div>
          </div>
        </main>
      </>
    )
  }

  return (
    <EngineProvider engine={engine ?? emptySource}>
      <RaceView session={session} data={data} engine={engine} />
    </EngineProvider>
  )
}
