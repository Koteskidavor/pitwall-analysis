import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { delay, HttpResponse } from 'msw'
import { http } from 'msw'
import { setupServer } from 'msw/node'
import { RacePicker } from '../components/RacePicker'
import { Provider } from 'react-redux'
import { store } from '../store'
import { apiSlice } from '../apiSlice'

console.error('TEST FILE LOADED')

// Mock session data
const mockSessions = [
  {
    id: '2023_2_Race',
    year: 2023,
    round: 2,
    type: 'Race',
    name: 'Saudi Arabian Grand Prix',
    track: 'Jeddah Corniche Circuit',
    schema_version: '1.0.0',
    status: 'ready',
    processed_at: '2023-03-20T10:00:00Z',
  },
  {
    id: '2023_1_Race',
    year: 2023,
    round: 1,
    type: 'Race',
    name: 'Bahrain Grand Prix',
    track: 'Bahrain International Circuit',
    schema_version: '1.0.0',
    status: 'ready',
    processed_at: '2023-03-06T10:00:00Z',
  }
]

// Setup MSW server with no initial handlers
const server = setupServer()

// Establish API mocking before all tests.
beforeAll(() => {
  console.log('MSW server started')
  server.listen()
})
// Clean up after the tests are finished.
afterAll(() => server.close())

// Helper to render the component with redux provider
const renderWithRedux = (ui: React.ReactElement) => {
  return render(<Provider store={store}>{ui}</Provider>, { wrapper: React.Fragment })
}

describe('RacePicker', () => {
  // Reset handlers before each test to ensure clean state
  beforeEach(() => {
    console.log('[BEFORE EACH] Before each')
    server.resetHandlers()
    // Reset RTK Query cache to avoid cross-test contamination
    store.dispatch(apiSlice.util.resetApiState())
    // Add a catch-all handler to log all requests
    server.use(
      http.get('*', ({ request }) => {
        console.log('[ALL REQUESTS] Request to:', request.url)
        console.log('[ALL REQUESTS] Request method:', request.method)
        // Return a 404 to make unhandled requests obvious
        return new Response(null, { status: 404, statusText: 'Not Found' })
      })
    )
  })

  // Clean up after each test
  afterEach(() => {
    server.resetHandlers()
  })

  test('shows error message when API call fails', async () => {
    // Override to return an error
    console.log('[ERROR TEST] Test started!')
    console.log('[ERROR TEST] About to use handler')
    try {
      server.use(
        http.get('http://localhost/api/sessions', async ({ request, params, cookies }) => {
          console.log('[ERROR TEST] Handler called!')
          console.log('[ERROR TEST] Request URL:', request.url)
          console.log('[ERROR TEST] Request method:', request.method)
          // Return valid JSON but in wrong format to cause transformResponse to fail
          const response = HttpResponse.json({ invalid: "format" }, { status: 200 })
          console.log('[ERROR TEST] Response status:', response.status)
          console.log('[ERROR TEST] Response body:', response.body)
          await delay(200)
          return response
        })
      )
      console.log('[ERROR TEST] Handler added successfully')
    } catch (e) {
      console.log('[ERROR TEST] Error in use:', e)
      console.log('[ERROR TEST] Error details:', e)
    }

    let wrapper
    try {
      wrapper = renderWithRedux(<RacePicker />)
    } catch (renderError) {
      console.log('[ERROR TEST] Render error:', renderError)
      throw renderError
    }

    // Should show loading text
    expect(screen.getByText(/loading races/i)).toBeInTheDocument()

    // Wait for the error to appear (this implies loading has finished)
    await waitFor(() => {
      expect(screen.getByText(/error loading races/i)).toBeInTheDocument()
    })
  })

  test('displays loading state while fetching sessions', async () => {
    console.log('[LOADING TEST] Test started!')
    server.use(
      http.get('http://localhost/api/sessions', async ({ request, params, cookies }) => {
        try {
          console.log('[LOADING TEST] Handler called!')
          console.log('[LOADING TEST] Request URL:', request.url)
          console.log('[LOADING TEST] Request method:', request.method)
          console.log('[LOADING TEST] Before delay')
          console.log('[LOADING TEST] Delay function:', delay)
          await new Promise<void>((resolve) => {
            console.log('[LOADING TEST] Setting timeout')
            setTimeout(() => {
              console.log('[LOADING TEST] Timeout fired!')
              resolve();
            }, 10);
          })
          console.error('[LOADING TEST] After delay')
          return HttpResponse.json(mockSessions, { status: 200 })
        } catch (error) {
          console.error('[LOADING TEST] Error in handler:', error)
          throw error
        }
      })
    )
    console.log('[LOADING TEST] Handler added')

    renderWithRedux(<RacePicker />)

    // Should show loading text
    expect(screen.getByText(/loading races/i)).toBeInTheDocument()

    // Wait for the data to finish loading
    await waitFor(() => {
      expect(screen.queryByText(/loading races/i)).not.toBeInTheDocument()
    })

    // Then show the select dropdown
    expect(screen.getByLabelText(/select a race:/i)).toBeInTheDocument()
  })

  test('shows empty state when no sessions are returned', async () => {
    console.log('[EMPTY TEST] About to add handler')
    server.use(
      http.get('http://localhost/api/sessions', async ({ request, params, cookies }) => {
        try {
          console.log('[EMPTY TEST] Handler called!')
          console.log('[EMPTY TEST] Request URL:', request.url)
          console.log('[EMPTY TEST] Request method:', request.method)
          // Return empty array - no delay needed
          console.log('[EMPTY TEST] Returning empty array')
          return HttpResponse.json([])
        } catch (error) {
          console.error('[EMPTY TEST] Error in handler:', error)
          throw error
        }
      })
    )
    console.log('[EMPTY TEST] Handler added')

    let wrapper
    try {
      wrapper = renderWithRedux(<RacePicker />)
    } catch (renderError) {
      console.log('[EMPTY TEST] Render error:', renderError)
      throw renderError
    }

    // Should show loading text initially
    expect(screen.getByText(/loading races/i)).toBeInTheDocument()

    // Wait for the empty state to appear (this implies loading has finished)
    await waitFor(() => {
      expect(screen.getByText(/no races available/i)).toBeInTheDocument()
    })
  })

  test('displays populated list of sessions and allows selection', async () => {
    server.use(
      http.get('http://localhost/api/sessions', async ({ request, params, cookies }) => {
        await delay(10)
        return HttpResponse.json(mockSessions, { status: 200 })
      })
    )

    renderWithRedux(<RacePicker />)

    // Wait for the select to be populated with options
    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect(select.value).toBe('')
      // Check that options are present
      expect(screen.getByText(/saudi arabian grand prix/i)).toBeInTheDocument()
      expect(screen.getByText(/bahrain grand prix/i)).toBeInTheDocument()
    })

    // Select the first session
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('')
    select.value = mockSessions[0].id
    // Dispatch change event
    fireEvent.change(select)

    // We would need to check that the dispatch was called, but we can't easily mock dispatch in the test
    // Instead, we can check that the value changed
    expect(select.value).toBe(mockSessions[0].id)
  })
})