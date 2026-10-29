import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import { z } from 'zod'
import {
  driverSchema,
  eventSchema,
  lapSchema,
  manifestSchema,
  pitStopSchema,
  resultSchema,
  sessionSchema,
  stintSchema,
  trackSchema,
} from '@pitwall/shared'

// Responses are parsed with the shared zod schemas so a malformed payload from
// the API fails at the boundary instead of leaking into the UI.
const sessionsResponseSchema = z.array(sessionSchema)
const driversResponseSchema = z.array(driverSchema)
const resultsResponseSchema = z.array(resultSchema)
const lapsResponseSchema = z.array(lapSchema)
const stintsResponseSchema = z.array(stintSchema)
const pitStopsResponseSchema = z.array(pitStopSchema)
const eventsResponseSchema = z.array(eventSchema)

// An empty baseUrl keeps every request relative, so the Vite dev proxy (and the
// production same-origin deploy) route /api to the API without CORS. Tests set
// VITE_API_BASE_URL to an absolute origin so MSW can intercept the requests.
export const apiSlice = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? '' }),
  tagTypes: ['Session', 'SessionData'],
  endpoints: (builder) => ({
    getSessions: builder.query<Array<z.infer<typeof sessionSchema>>, void>({
      query: () => '/api/sessions',
      transformResponse: (response: unknown) => sessionsResponseSchema.parse(response),
      providesTags: ['Session'],
    }),
    getSession: builder.query<z.infer<typeof sessionSchema>, string>({
      query: (sessionId) => `/api/sessions/${sessionId}`,
      transformResponse: (response: unknown) => sessionSchema.parse(response),
    }),
    getManifest: builder.query<z.infer<typeof manifestSchema>, string>({
      query: (sessionId) => `/api/sessions/${sessionId}/manifest`,
      transformResponse: (response: unknown) => manifestSchema.parse(response),
    }),
    getTrack: builder.query<z.infer<typeof trackSchema>, string>({
      query: (sessionId) => `/api/sessions/${sessionId}/track`,
      transformResponse: (response: unknown) => trackSchema.parse(response),
    }),
    getDrivers: builder.query<Array<z.infer<typeof driverSchema>>, string>({
      query: (sessionId) => `/api/sessions/${sessionId}/drivers`,
      transformResponse: (response: unknown) => driversResponseSchema.parse(response),
    }),
    getResults: builder.query<Array<z.infer<typeof resultSchema>>, string>({
      query: (sessionId) => `/api/sessions/${sessionId}/results`,
      transformResponse: (response: unknown) => resultsResponseSchema.parse(response),
    }),
    getLaps: builder.query<Array<z.infer<typeof lapSchema>>, string>({
      query: (sessionId) => `/api/sessions/${sessionId}/laps`,
      transformResponse: (response: unknown) => lapsResponseSchema.parse(response),
      providesTags: ['SessionData'],
    }),
    getStints: builder.query<Array<z.infer<typeof stintSchema>>, string>({
      query: (sessionId) => `/api/sessions/${sessionId}/stints`,
      transformResponse: (response: unknown) => stintsResponseSchema.parse(response),
      providesTags: ['SessionData'],
    }),
    getPitStops: builder.query<Array<z.infer<typeof pitStopSchema>>, string>({
      query: (sessionId) => `/api/sessions/${sessionId}/pit-stops`,
      transformResponse: (response: unknown) => pitStopsResponseSchema.parse(response),
      providesTags: ['SessionData'],
    }),
    getEvents: builder.query<Array<z.infer<typeof eventSchema>>, string>({
      query: (sessionId) => `/api/sessions/${sessionId}/events`,
      transformResponse: (response: unknown) => eventsResponseSchema.parse(response),
      providesTags: ['SessionData'],
    }),
    // gaps.bin is opaque binary: the byte length is validated by the shared
    // decoder when the caller builds a GapTable.
    getGaps: builder.query<ArrayBuffer, string>({
      query: (sessionId) => ({
        url: `/api/sessions/${sessionId}/binary/gaps`,
        responseHandler: (response: Response) => response.arrayBuffer(),
      }),
      providesTags: ['SessionData'],
    }),
  }),
})

export const {
  useGetSessionsQuery,
  useGetSessionQuery,
  useGetManifestQuery,
  useGetTrackQuery,
  useGetDriversQuery,
  useGetResultsQuery,
  useGetLapsQuery,
  useGetStintsQuery,
  useGetPitStopsQuery,
  useGetEventsQuery,
  useGetGapsQuery,
} = apiSlice
