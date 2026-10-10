import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import { z } from 'zod'
import { sessionSchema } from '../../shared/src/schemas'

// Define a zod schema for the response (array of sessions)
const sessionsResponseSchema = z.array(sessionSchema)

// Define the API slice
export const apiSlice = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: 'http://localhost', // Base URL for the API
  }),
  tagTypes: ['Session'],
  endpoints: (builder) => ({
    getSessions: builder.query<Array<z.infer<typeof sessionSchema>>, void>({
      query: () => '/api/sessions',
      // Validate the response using zod
      transformResponse: (response: unknown) => {
        return sessionsResponseSchema.parse(response)
      },
    }),
  }),
})

// Export hooks for usage in functional components
export const { useGetSessionsQuery } = apiSlice