import React from 'react'
import { useGetSessionsQuery } from '../apiSlice'
import { useAppDispatch, useAppSelector } from '../store'
import { setSelectedSessionId } from '../uiSlice'

export const RacePicker: React.FC = () => {
  const { data: sessions, isLoading, isError, error } = useGetSessionsQuery()
  const dispatch = useAppDispatch()
  const selectedSessionId = useAppSelector(state => state.ui.selectedSessionId)

  if (isLoading) {
    return <div>Loading races...</div>
  }

  if (isError) {
    return <div>Error loading races: {(error as Error)?.message}</div>
  }

  // If we have data but it's empty
  if (!sessions || sessions.length === 0) {
    return <div>No races available</div>
  }

  return (
    <div>
      <label htmlFor="race-select">Select a race: </label>
      <select
        id="race-select"
        value={selectedSessionId ?? ''}
        onChange={(e) => {
          const sessionId = e.target.value
          dispatch(setSelectedSessionId(sessionId || null))
        }}
      >
        <option value="">-- Select a race --</option>
        {sessions.map((session) => (
          <option key={session.id} value={session.id}>
            {session.name} ({session.year} Round {session.round})
          </option>
        ))}
      </select>
    </div>
  )
}