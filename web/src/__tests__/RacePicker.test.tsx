import React from 'react'
import { beforeEach, afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { http, HttpResponse, delay } from 'msw'
import { setupServer } from 'msw/node'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import { RacePickerPage } from '../pages/RacePickerPage'
import { store } from '../store'
import { apiSlice } from '../apiSlice'

const mockSessions = [
  {
    id: '2025_1_Race',
    year: 2025,
    round: 1,
    type: 'Race',
    name: 'Australian Grand Prix',
    track: 'Melbourne',
    schema_version: '1.0.0',
    status: 'ready',
    processed_at: '2026-10-18T06:18:54Z',
    session_date: '2025-03-16T10:00:00Z',
    dataTier: 'full',
    winner: 'NOR',
    trackOutline: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
  },
  {
    id: '2025_2_Race',
    year: 2025,
    round: 2,
    type: 'Race',
    name: 'Chinese Grand Prix',
    track: 'Shanghai',
    schema_version: '1.0.0',
    status: 'ready',
    processed_at: '2026-10-18T06:18:54Z',
    session_date: '2025-03-23T10:00:00Z',
    dataTier: 'results',
    winner: 'PIA',
  },
]

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

beforeEach(() => {
  store.dispatch(apiSlice.util.resetApiState())
})

function renderPicker() {
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/']}>
        <RacePickerPage />
      </MemoryRouter>
    </Provider>,
  )
}

describe('RacePickerPage', () => {
  it('renders a card per session grouped by season', async () => {
    server.use(
      http.get('http://localhost/api/sessions', async () => {
        await delay(5)
        return HttpResponse.json(mockSessions)
      }),
    )

    renderPicker()

    // Skeleton first.
    expect(document.querySelectorAll('.skeleton').length).toBeGreaterThan(0)

    await waitFor(() => {
      expect(screen.getByTestId('race-card-2025_1_Race')).toBeInTheDocument()
    })

    expect(screen.getByText('Australian Grand Prix')).toBeInTheDocument()
    expect(screen.getByText('Chinese Grand Prix')).toBeInTheDocument()
    expect(screen.getByTestId('season-group-2025')).toBeInTheDocument()
    // Tier badges and the winner marker are shown.
    expect(screen.getByText('Full telemetry')).toBeInTheDocument()
    expect(screen.getByText('Results only')).toBeInTheDocument()
    expect(screen.getByText('NOR')).toBeInTheDocument()
    // Cards link to the race page.
    expect(screen.getByTestId('race-card-2025_2_Race')).toHaveAttribute(
      'href',
      '/races/2025_2_Race',
    )
  })

  it('names the ingest command when nothing has been processed', async () => {
    server.use(http.get('http://localhost/api/sessions', () => HttpResponse.json([])))

    renderPicker()

    expect(await screen.findByTestId('races-empty')).toBeInTheDocument()
    expect(screen.getByText(/No races processed yet/i)).toBeInTheDocument()
    expect(screen.getByText(/etl\/src\/cli\.py ingest/)).toBeInTheDocument()
  })

  it('shows an error card with a retry button when the API fails', async () => {
    let calls = 0
    server.use(
      http.get('http://localhost/api/sessions', () => {
        calls += 1
        return HttpResponse.json({ error: 'boom' }, { status: 500 })
      }),
    )

    renderPicker()

    const error = await screen.findByTestId('races-error')
    expect(error).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(calls).toBeGreaterThan(1))
  })
})
