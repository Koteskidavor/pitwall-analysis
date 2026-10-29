# API Routes Reference

This document describes all available API endpoints in the pitwall-analysis application.

## Base URL
All endpoints are relative to the API base URL (e.g., `http://localhost:3001`).

## Sessions

### List All Sessions
- **GET** `/api/sessions`
- **Description**: Returns a list of all available sessions.
- **Success Response**:
  - Code: 200 OK
  - Content: Array of session objects
  - Schema: `z.array(sessionSchema)`
- **Error Responses**:
  - Code: 500 Internal Server Error
    - Content: `{ error: 'Internal server error' }`

### Get Session by ID
- **GET** `/api/sessions/:id`
- **Description**: Returns metadata for a specific session.
- **Parameters**:
  - `:id` (string, required): Session identifier (e.g., `2025_1_Race`)
- **Success Response**:
  - Code: 200 OK
  - Content: Session object
  - Schema: `sessionSchema`
- **Error Responses**:
  - Code: 404 Not Found
    - Content: `{ error: 'Session not found' }`
  - Code: 500 Internal Server Error
    - Content: `{ error: 'Internal server error' }`

## Lap Data

### Get All Laps for a Session
- **GET** `/api/sessions/:id/laps`
- **Description**: Returns all lap records for a session.
- **Parameters**:
  - `:id` (string, required): Session identifier
- **Success Response**:
  - Code: 200 OK
  - Content: Array of lap objects
  - Schema: `z.array(lapSchema)`
- **Error Responses**:
  - Code: 404 Not Found
    - Content: `{ error: 'Session not found' }`
  - Code: 500 Internal Server Error
    - Content: `{ error: 'Internal server error' }`

### Get Laps for a Driver in a Session
- **GET** `/api/sessions/:sessionId/drivers/:driverId/laps`
- **Description**: Returns lap records for a specific driver in a session.
- **Parameters**:
  - `:sessionId` (string, required): Session identifier
  - `:driverId` (string, required): Driver identifier (e.g., `VER`)
- **Success Response**:
  - Code: 200 OK
  - Content: Array of lap objects
  - Schema: `z.array(lapSchema)`
- **Error Responses**:
  - Code: 404 Not Found
    - Content: `{ error: 'Session not found' }`
  - Code: 500 Internal Server Error
    - Content: `{ error: 'Internal server error' }`

## Stint Data

### Get All Stints for a Session
- **GET** `/api/sessions/:id/stints`
- **Description**: Returns all stint records for a session.
- **Parameters**:
  - `:id` (string, required): Session identifier
- **Success Response**:
  - Code: 200 OK
  - Content: Array of stint objects
  - Schema: `z.array(stintSchema)`
- **Error Responses**:
  - Code: 404 Not Found
    - Content: `{ error: 'Session not found' }`
  - Code: 500 Internal Server Error
    - Content: `{ error: 'Internal server error' }`

### Get Stints for a Driver in a Session
- **GET** `/api/sessions/:sessionId/drivers/:driverId/stints`
- **Description**: Returns stint records for a specific driver in a session.
- **Parameters**:
  - `:sessionId` (string, required): Session identifier
  - `:driverId` (string, required): Driver identifier
- **Success Response**:
  - Code: 200 OK
  - Content: Array of stint objects
  - Schema: `z.array(stintSchema)`
- **Error Responses**:
  - Code: 404 Not Found
    - Content: `{ error: 'Session not found' }`
  - Code: 500 Internal Server Error
    - Content: `{ error: 'Internal server error' }`

## Pit Stop Data

### Get All Pit Stops for a Session
- **GET** `/api/sessions/:id/pit-stops`
- **Description**: Returns all pit stop records for a session.
- **Parameters**:
  - `:id` (string, required): Session identifier
- **Success Response**:
  - Code: 200 OK
  - Content: Array of pit stop objects
  - Schema: `z.array(pitStopSchema)`
- **Error Responses**:
  - Code: 404 Not Found
    - Content: `{ error: 'Session not found' }`
  - Code: 500 Internal Server Error
    - Content: `{ error: 'Internal server error' }`

### Get Pit Stops for a Driver in a Session
- **GET** `/api/sessions/:sessionId/drivers/:driverId/pit-stops`
- **Description**: Returns pit stop records for a specific driver in a session.
- **Parameters**:
  - `:sessionId` (string, required): Session identifier
  - `:driverId` (string, required): Driver identifier
- **Success Response**:
  - Code: 200 OK
  - Content: Array of pit stop objects
  - Schema: `z.array(pitStopSchema)`
- **Error Responses**:
  - Code: 404 Not Found
    - Content: `{ error: 'Session not found' }`
  - Code: 500 Internal Server Error
    - Content: `{ error: 'Internal server error' }`

## Event Data

### Get All Events for a Session
- **GET** `/api/sessions/:id/events`
- **Description**: Returns all event records for a session.
- **Parameters**:
  - `:id` (string, required): Session identifier
- **Success Response**:
  - Code: 200 OK
  - Content: Array of event objects
  - Schema: `z.array(eventSchema)`
- **Error Responses**:
  - Code: 404 Not Found
    - Content: `{ error: 'Session not found' }`
  - Code: 500 Internal Server Error
    - Content: `{ error: 'Internal server error' }`

### Get Events for a Driver in a Session
- **GET** `/api/sessions/:sessionId/drivers/:driverId/events`
- **Description**: Returns event records for a specific driver in a session.
- **Parameters**:
  - `:sessionId` (string, required): Session identifier
  - `:driverId` (string, required): Driver identifier
- **Success Response**:
  - Code: 200 OK
  - Content: Array of event objects
  - Schema: `z.array(eventSchema)`
- **Error Responses**:
  - Code: 404 Not Found
    - Content: `{ error: 'Session not found' }`
  - Code: 500 Internal Server Error
    - Content: `{ error: 'Internal server error' }`

## Binary Data

### Get Motion Binary Chunk
- **GET** `/api/sessions/:id/binary/motion/:chunkIndex`
- **Description**: Returns raw binary data for a motion chunk.
- **Parameters**:
  - `:id` (string, required): Session identifier
  - `:chunkIndex` (integer, required): Zero-based chunk index (must be >= 0)
- **Success Response**:
  - Code: 200 OK
  - Content: Binary data (application/octet-stream)
  - Headers:
    - `ETag`: W/\"<hash>\" (MD5 hash of file content)
    - `Content-Type`: application/octet-stream
  - Note: Supports caching via `If-None-Match` header (returns 304 if unchanged)
- **Error Responses**:
  - Code: 400 Bad Request
    - Content: `{ error: 'Chunk index required for motion data' }` (if chunkIndex missing)
    - Content: `{ error: 'Invalid chunk index' }` (if chunkIndex not a non-negative integer)
    - Content: `{ error: 'Invalid parameter' }` (if path traversal detected)
  - Code: 404 Not Found
    - Content: `{ error: 'Session not found' }` or `{ error: 'Binary data not found' }`
  - Code: 500 Internal Server Error
    - Content: `{ error: 'Internal server error' }`

### Get Gaps Binary Data
- **GET** `/api/sessions/:id/binary/gaps`
- **Description**: Returns raw binary data for the gaps file.
- **Parameters**:
  - `:id` (string, required): Session identifier
  - Note: The `:chunkIndex` parameter is ignored for gaps data.
- **Success Response**:
  - Code: 200 OK
  - Content: Binary data (application/octet-stream)
  - Headers:
    - `ETag`: W/\"<hash>\" (MD5 hash of file content)
    - `Content-Type`: application/octet-stream
  - Note: Supports caching via `If-None-Match` header (returns 304 if unchanged)
- **Error Responses**:
  - Code: 400 Bad Request
    - Content: `{ error: 'Invalid parameter' }` (if path traversal detected)
  - Code: 404 Not Found
    - Content: `{ error: 'Session not found' }` or `{ error: 'Binary data not found' }`
  - Code: 500 Internal Server Error
    - Content: `{ error: 'Internal server error' }`

### Alternative Binary Route (Wildcard)
The API also accepts a wildcard route for binary data:
- **GET** `/api/sessions/:id/binary/*`
  - The wildcard is split by `/` to determine `type` and optional `chunkIndex`.
  - Valid `type` values: `motion` or `gaps`.
  - For `motion`, the second segment is treated as `chunkIndex`.
  - All validation and responses are identical to the specific routes above.

## Data Types

All times in API responses are milliseconds since lights-out.

### Session Object
```typescript
{
  id: string;          // e.g., "2025_1_Race"
  year: number;        // e.g., 2025
  round: number;       // e.g., 2
  type: string;        // e.g., "Race"
  name: string;        // e.g., "Saudi Arabian Grand Prix"
  track: string;       // e.g., "saudi_arabian"
  schema_version: string; // "1.0.0"
  status: "ready" | "failed";
  processed_at: string | null; // ISO timestamp of when the ETL processed the session
  session_date: string | null; // ISO timestamp the race actually took place
}
```

### Lap Object
```typescript
{
  lap_time_ms: number;     // Lap duration in ms
  lap_start_ms: number;    // Start time since lights-out
  lap_end_ms: number;      // End time since lights-out
  s1_ms: number | null;    // Sector 1 time
  s2_ms: number | null;    // Sector 2 time
  s3_ms: number | null;    // Sector 3 time
  position: number | null; // Position at end of lap
  compound: string | null; // Tyre compound
  tyre_age: number;        // Tyre age in laps
  is_accurate: boolean;    // Lap time accuracy flag
  is_pit_in: boolean;      // True if lap contains pit-in
  is_pit_out: boolean;     // True if lap contains pit-out
  driverId: string;        // Driver identifier
  lap: number;             // Lap number
}
```

### Stint Object
```typescript
{
  driverId: string;   // Driver identifier
  lapStart: number;   // Starting lap of stint
  lapEnd: number;     // Ending lap of stint
  compound: string;   // Tyre compound
  tyreAgeAtStart: number; // Tyre age at start of stint
}
```

### Pit Stop Object
```typescript
{
  driverId: string;   // Driver identifier
  lap: number;        // Lap number of pit stop
  time_ms: number;    // Time since lights-out when pit-in occurred
  duration_ms: number; // Pit stop duration in ms
}
```

### Event Object
```typescript
{
  id: string;           // Event identifier
  timestamp_ms: number; // Time since lights-out
  type: string;         // Event type
  driverId: string | null; // Associated driver (if any)
  message: string | null; // Event description
}
```

## Error Format
All error responses follow the format:
```json
{
  "error": "Human-readable error message"
}
```

## Implementation Notes
- The API is read-only; no endpoints modify data.
- All data is validated against Zod schemas before being sent.
- Binary endpoints include ETag headers for efficient caching.
- Path traversal attacks are prevented by validating input parameters.
- Sessions are looked up in the SQLite database under `DATA_ROOT/sessions/`.