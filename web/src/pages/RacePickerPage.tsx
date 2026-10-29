import React, { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Session } from '@pitwall/shared'
import { useGetSessionsQuery } from '../apiSlice'
import { TopBar } from '../components/TopBar'
import { RaceCard } from '../components/RaceCard'

const SESSION_TYPE = 'Race'

function groupByYear(sessions: Session[]): Array<[number, Session[]]> {
  const groups = new Map<number, Session[]>()
  for (const session of sessions) {
    const list = groups.get(session.year)
    if (list) list.push(session)
    else groups.set(session.year, [session])
  }
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, rows]) => [year, rows.sort((a, b) => a.round - b.round)])
}

const SkeletonGrid: React.FC = () => (
  <div className="grid" aria-hidden="true">
    {Array.from({ length: 6 }).map((_, index) => (
      <div className="skeleton" key={index} />
    ))}
  </div>
)

export const RacePickerPage: React.FC = () => {
  const [params, setParams] = useSearchParams()
  const { data: sessions, isLoading, isError, refetch } = useGetSessionsQuery()

  const years = useMemo(() => {
    const set = new Set(
      (sessions ?? [])
        .filter((session) => session.type === SESSION_TYPE)
        .map((session) => session.year),
    )
    return [...set].sort((a, b) => b - a)
  }, [sessions])

  const seasonParam = params.get('season')
  const requestedSeason =
    seasonParam === 'all' ? 'all' : seasonParam ? Number(seasonParam) : undefined
  const season: number | 'all' =
    requestedSeason === 'all'
      ? 'all'
      : years.includes(requestedSeason as number)
        ? (requestedSeason as number)
        : (years[0] ?? 'all')

  const updateParam = (key: string, value: string): void => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set(key, value)
        return next
      },
      { replace: true },
    )
  }

  const filtered = useMemo(
    () =>
      (sessions ?? []).filter(
        (session) =>
          (season === 'all' || session.year === season) && session.type === SESSION_TYPE,
      ),
    [sessions, season],
  )

  const groups = useMemo(() => groupByYear(filtered), [filtered])
  const hasAnySession = (sessions ?? []).some((session) => session.type === SESSION_TYPE)

  return (
    <>
      <TopBar />
      <main className="page">
        <div className="filter-row" role="group" aria-label="Race filters">
          <div className="field">
            <label htmlFor="season-select">Season</label>
            <select
              id="season-select"
              className="select"
              value={season === 'all' ? 'all' : String(season)}
              disabled={isLoading || !hasAnySession}
              onChange={(event) => updateParam('season', event.target.value)}
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
              <option value="all">All seasons</option>
            </select>
          </div>
        </div>

        {isLoading && (
          <>
            <div className="section-heading">
              <h2>Races</h2>
            </div>
            <SkeletonGrid />
          </>
        )}

        {isError && (
          <div className="state-card state-card--error" role="alert" data-testid="races-error">
            <h2>Could not load races</h2>
            <p>The API did not respond. Check that it is running, then retry.</p>
            <button type="button" className="button button--danger" onClick={() => refetch()}>
              Retry
            </button>
          </div>
        )}

        {!isLoading && !isError && !hasAnySession && (
          <div className="state-card" data-testid="races-empty">
            <h2>No races processed yet</h2>
            <p>Ingest a race to populate the picker, then reload this page.</p>
            <code>python etl/src/cli.py ingest 2025 1 Race</code>
          </div>
        )}

        {!isLoading && !isError && hasAnySession && groups.length === 0 && (
          <div className="state-card" data-testid="races-filtered-empty">
            <h2>No race sessions found</h2>
            <p>Try another season.</p>
          </div>
        )}

        {!isLoading &&
          !isError &&
          groups.map(([year, yearSessions]) => (
            <section key={year} aria-labelledby={`season-${year}`}>
              <div className="section-heading">
                <h2 id={`season-${year}`}>{year}</h2>
                <span>
                  {yearSessions.length} {yearSessions.length === 1 ? 'session' : 'sessions'}
                </span>
              </div>
              <div className="grid" data-testid={`season-group-${year}`}>
                {yearSessions.map((session) => (
                  <RaceCard key={session.id} session={session} />
                ))}
              </div>
            </section>
          ))}
      </main>
    </>
  )
}
