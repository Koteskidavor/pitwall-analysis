# Pitwall Analytics

**A Formula 1 race replay and telemetry explorer.** Pitwall ingests real race data into a compact, offline-friendly session format, serves it through a read-only API, and replays the race in the browser with a live track map, running order, gaps, tyre information and lap timing.

> [!NOTE]
> This is an unofficial community project and is not affiliated with Formula 1. Race data is sourced from [FastF1](https://github.com/theOehrly/Fast-F1) and [OpenF1](https://openf1.org), and all F1 trademarks remain the property of their respective owners.

---

## Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Technology stack](#technology-stack)
- [Repository layout](#repository-layout)
- [Quick start](#quick-start)
- [Ingesting data](#ingesting-data)
- [Available scripts](#available-scripts)
- [API](#api)
- [Data format](#data-format)
- [Replay engine](#replay-engine)
- [Configuration](#configuration)
- [Testing and quality checks](#testing-and-quality-checks)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [Documentation](#documentation)

---

## Overview

Pitwall is split into four parts:

1. **Python ETL** — downloads race data, cleans it, and writes a self-contained session directory containing SQLite tables, JSON metadata and compact binary telemetry.
2. **Fastify API** — exposes sessions and binary artifacts through a read-only REST interface.
3. **React web app** — lets you browse races and replay them at up to 16× speed.
4. **Shared package** — contains the Zod schemas, TypeScript types and binary decoders used by both the API and the web app.

The replay is driven by motion samples captured at **5 Hz** and packaged into **60-second chunks**. The browser only downloads the chunks it needs, decodes them client-side and interpolates between samples for smooth playback.

---

## Features

### Race library

- Browse processed races grouped by season.
- Track thumbnails, race date, round number, winner and data-tier badges on each card.
- Season filtering, loading skeletons and explicit empty/error states.

### Synchronized replay

- Play/pause, scrubber, 1×/2×/4×/8×/16× speeds and 5-second rewind.
- Keyboard shortcuts: `Space` toggles playback, `←`/`→` scrub by 5 seconds.
- HTTP chunk loading with an LRU cache and look-ahead prefetching.
- Linear interpolation between 5 Hz samples and across chunk boundaries.

### Live race view

- Canvas track map with a static layer (outline, sector boundaries, start/finish) and a dynamic layer (one marker per driver).
- Driver highlighting through markers, chips, the leaderboard and tables.
- Click-to-select drivers directly on the track map.
- Pit-lane and retired-driver visual states.

### Leaderboard and timing

- Live running order derived from completed laps plus within-lap progress.
- Gap to leader and interval to the car ahead.
- Tyre compound and tyre age, pit-stop count and pit-lane state.
- FLIP-style row animations on position changes.
- Final classification, per-driver lap table, flagged-lap indicators and a race-clock/lap readout.
- Race-control markers on the scrubber when session events are available.

### Data reliability

- Shared Zod schemas validate API payloads at the web boundary and static artifacts in the API.
- Explicit `full` versus `results` data tiers, so sessions without telemetry still open with the classification and lap tables.
- Atomic JSON and binary writes in the ETL (`*.tmp` then rename) to avoid partially written artifacts.
- ETag support for binary responses, including `304 Not Modified`.
- Read-only SQLite connections with per-session caching.

---

## Architecture

```text
                ┌─────────────────────┐
                │     Data sources    │
                │  FastF1  (pre-2024) │
                │  OpenF1  (2024+)    │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │      Python ETL     │
                │ fetch → clean → bin │
                └──────────┬──────────┘
                           │
                           ▼
        data/sessions/<year>_<round>_<session>/
        ├── data.sqlite     (timing tables)
        ├── manifest.json   (session metadata)
        ├── track.json      (geometry)
        ├── motion/NNN.bin  (5 Hz telemetry)
        └── gaps.bin        (checkpoint times)
                           │
                           ▼
                ┌─────────────────────┐
                │    Fastify API      │
                │  JSON + binaries    │
                └──────────┬──────────┘
                           │  /api/*
                           ▼
                ┌─────────────────────┐
                │   React web app     │
                │  replay + analysis  │
                └─────────────────────┘

          shared/  ← Zod schemas, types and binary decoders
```

The web app uses relative `/api` URLs. In development, Vite proxies those requests to the API; in production, serve the built web assets and reverse-proxy `/api` to the API on the same origin.

---

## Technology stack

| Layer | Technologies |
|-------|--------------|
| ETL | Python 3.12, FastF1, OpenF1, pandas, NumPy, SQLite |
| API | Node.js, TypeScript, Fastify 5, better-sqlite3, TypeBox |
| Web | React 19, TypeScript, Vite 8, Redux Toolkit + RTK Query, React Router 7 |
| Shared | TypeScript, Zod, DataView binary codecs |
| Testing | Vitest, Testing Library, MSW, jsdom |
| Tooling | npm workspaces, ESLint, Prettier, tsc |

---

## Repository layout

```text
.
├── api/                    Fastify server, controllers, storage and route tests
│   ├── src/
│   │   ├── controllers/    Sessions and binary request handlers
│   │   ├── models/         Storage interface + SQLite implementation
│   │   ├── views/          Binary and error response rendering
│   │   ├── routes.ts       Route registration
│   │   └── server.ts       Fastify app factory and entry point
│   └── tests/              API tests and on-disk fixture builder
├── docs/
│   ├── FORMAT.md           On-disk session and binary format reference
│   └── ROUTES.md           HTTP API reference
├── etl/
│   └── src/
│       ├── cli.py          Single-race ingest command
│       ├── ingest_season.py Whole-season ingest command
│       ├── fetch.py        FastF1/OpenF1 source selection and normalization
│       ├── openf1.py       OpenF1-backed FastF1-compatible session adapter
│       ├── writer.py       SQLite, manifest, track and binary writers
│       ├── motion.py       Motion sample generation and track projection
│       ├── gaps.py         Checkpoint crossing-time generation
│       └── paths.py        Data-root and artifact path helpers
├── shared/
│   └── src/
│       ├── schemas.ts       Zod schemas and shared types
│       ├── binary-decoder.ts Motion and gaps decoders
│       └── validate-data.ts CLI integrity check for processed sessions
├── web/
│   └── src/
│       ├── pages/           Race picker and race replay pages
│       ├── components/      Track map, tables, controls and cards
│       ├── features/leaderboard/ Live order, gaps and formatting
│       ├── engine.ts        Chunked replay engine + LRU cache
│       ├── playbackSlice.ts Redux playback state and transport actions
│       └── apiSlice.ts      RTK Query endpoints with Zod validation
├── data/                    Generated sessions (gitignored)
├── .env.example             Documented environment variables
└── package.json             Workspace root and shared scripts
```

---

## Quick start

### Prerequisites

- **Node.js** `^20.19.0` or `>=22.12.0` (required by Vite 8) and npm.
- **Python** 3.11+; the project is developed and tested with Python 3.12.
- Internet access for the first ingest. Subsequent runs reuse cached upstream data.
- All commands below are run from the repository root.

### 1. Install JavaScript dependencies

```bash
npm install
```

This installs the `shared`, `api` and `web` workspaces.

### 2. Create the Python environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install fastf1 pandas numpy
```

FastF1 pulls in its own dependencies (including `requests-cache`, `scipy` and `matplotlib`). OpenF1 access in this project uses the Python standard library, so no extra SDK is needed.

### 3. Configure the environment

```bash
cp .env.example .env
```

The example documents the two supported API variables:

```dotenv
DATA_ROOT=./data
API_PORT=3001
```

The current dev scripts do **not** load `.env` automatically. Source the file or
export the values in your shell before starting the API:

```bash
set -a
source .env
set +a
```

Alternatively, use a tool such as `direnv` or pass the variables inline.

If you change `API_PORT`, also update the Vite proxy target in `web/vite.config.ts`.

### 4. Ingest a race

From the repository root, with the virtual environment active:

```bash
python etl/src/cli.py ingest 2025 10 Race
```

This downloads the race, writes a session directory under `data/sessions/`, and can take a few minutes on the first run.

### 5. Start the app

```bash
npm run dev
```

- Web app: <http://localhost:5173>
- API: <http://localhost:3001>

The race picker lists processed `Race` sessions. Open one to start the replay.

---

## Ingesting data

### Single race

```bash
python etl/src/cli.py ingest <year> <round> <session>
```

| Argument | Description |
|----------|-------------|
| `year` | Season year, e.g. `2025` |
| `round` | Round number for that season |
| `session` | `Race`, `Qualifying` or `Sprint` (the UI currently exposes races) |

For OpenF1-backed seasons (2024+), rounds follow **OpenF1 meeting order with pre-season testing excluded**. For pre-2024 seasons, FastF1's round numbering is used.

### Whole season

```bash
python etl/src/ingest_season.py 2025 2026 --resume
```

`--resume` skips sessions that already have both `manifest.json` and `data.sqlite`, so a failed or partial run can be restarted safely. Meetings without results yet are skipped automatically.

### Fixture-sized ingest

For local development, limit the amount of output written:

```bash
python etl/src/cli.py ingest 2025 10 Race --fixture --drivers 4 --laps 5
```

`--fixture` enables driver limiting (default 4 drivers), `--drivers` sets the driver count, and `--laps` keeps the first N laps **per selected driver**. This still fetches the real session from the upstream source; it only slices what is written.

### Data sources and caching

| Season | Source | Notes |
|--------|--------|-------|
| 2024+ | OpenF1 | FastF1's live-timing archive is no longer publicly available for recent seasons, so the ETL uses an OpenF1-backed adapter. Requests are throttled and cached. |
| 2023 and earlier | FastF1 | Uses FastF1's local cache. |

Caches live under `etl/.cache/`:

- `etl/.cache/openf1/` — OpenF1 JSON responses.
- FastF1's cache directory, managed by FastF1.

Delete the relevant cache directory to force a fresh download. The first full-season ingest is slow because telemetry is downloaded per driver, subject to OpenF1's free-tier rate limit.

### Artifacts produced

Each session is written atomically to `data/sessions/<year>_<round>_<session>/`:

| File | Purpose |
|------|---------|
| `data.sqlite` | Sessions, drivers, laps, stints, pit stops, events and results |
| `manifest.json` | Sampling rate, chunk count, driver order, lap count and duration |
| `track.json` | Track outline, sector geometry and bounds |
| `motion/000.bin`, `001.bin`, … | 60-second chunks of 5 Hz motion samples |
| `gaps.bin` | Per-driver, per-lap checkpoint crossing times derived from lap/sector timing (fallback) |

See [`docs/FORMAT.md`](docs/FORMAT.md) for the full binary and table reference.

---

## Available scripts

Run these from the repository root.

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the API and web dev server together |
| `npm run dev:api` | Start only the API with `tsx watch` |
| `npm run dev:web` | Start only the Vite web server |
| `npm run build` | Type-check and build the web app into `web/dist` |
| `npm run preview` | Preview the built web app with Vite |
| `npm test` | Run all workspace test suites |
| `npm run typecheck` | Type-check every TypeScript workspace |
| `npm run lint` | Run ESLint across the repository |
| `npm run validate:data` | Validate every processed `manifest.json` and `track.json` |
| `npm run start -w @pitwall/api` | Start the API without watch mode |
| `npm run test -w @pitwall/web` | Run only the web test suite |

The API is executed with `tsx`; `npm run build` produces the web bundle only. For a production deployment, run the API with `npm run start -w @pitwall/api` and serve `web/dist` from a static host or reverse proxy.

---

## API

The API listens on `http://localhost:3001` by default and is read-only.

| Method | Endpoint | Returns |
|--------|----------|---------|
| `GET` | `/api/sessions` | All sessions, enriched with `dataTier`, `trackOutline` and `winner` |
| `GET` | `/api/sessions/:id` | One session |
| `GET` | `/api/sessions/:id/manifest` | Session `manifest.json` |
| `GET` | `/api/sessions/:id/track` | Session `track.json` |
| `GET` | `/api/sessions/:id/drivers` | Driver list |
| `GET` | `/api/sessions/:id/results` | Final classification |
| `GET` | `/api/sessions/:id/laps` | All laps |
| `GET` | `/api/sessions/:id/drivers/:driverId/laps` | Laps for one driver |
| `GET` | `/api/sessions/:id/stints` | All stints |
| `GET` | `/api/sessions/:id/drivers/:driverId/stints` | Stints for one driver |
| `GET` | `/api/sessions/:id/pit-stops` | All pit stops |
| `GET` | `/api/sessions/:id/drivers/:driverId/pit-stops` | Pit stops for one driver |
| `GET` | `/api/sessions/:id/events` | Session-wide and driver events |
| `GET` | `/api/sessions/:id/drivers/:driverId/events` | Driver events plus session-wide events |
| `GET` | `/api/sessions/:id/binary/motion/:chunkIndex` | Motion chunk (`application/octet-stream`) |
| `GET` | `/api/sessions/:id/binary/gaps` | Gaps file (`application/octet-stream`) |

Binary routes are registered through a wildcard handler, so `motion/:chunkIndex` and `gaps` are the two valid shapes. Binary responses include an MD5 `ETag`; send it back as `If-None-Match` to receive `304 Not Modified`.

Example:

```bash
curl http://localhost:3001/api/sessions
curl http://localhost:3001/api/sessions/2025_10_Race
curl http://localhost:3001/api/sessions/2025_10_Race/binary/motion/0 --output motion-000.bin
```

Errors use one shape:

```json
{ "error": "Human-readable message" }
```

Common status codes are `400` for invalid binary paths or chunk indices, `404` for missing sessions/artifacts, and `500` for unexpected failures. Full details, including response schemas and validation rules, are in [`docs/ROUTES.md`](docs/ROUTES.md).

> [!IMPORTANT]
> No CORS plugin is configured. The web app expects to call the API through the Vite dev proxy or a same-origin reverse proxy.

---

## Data format

All timing values are **milliseconds since lights-out**, unless a field explicitly contains an ISO date (`session_date`, `processed_at`).

### SQLite tables

| Table | Contents |
|-------|----------|
| `sessions` | Session identity, year, round, type, event name, circuit, schema version, status and dates |
| `drivers` | Driver id/code, display name and nationality |
| `laps` | Lap duration, start/end time, sectors, position, compound, tyre age and pit flags |
| `stints` | Per-driver stint ranges, compound and tyre age at stint start |
| `pit_stops` | Pit lap, pit-in time and pit duration |
| `events` | Race-control, track-status and session-status messages |
| `results` | Final position, grid slot, total time, gap and points |

### Motion chunks

A motion chunk contains `driverCount × 300` samples (60 seconds at 5 Hz). Data is stored as **five field planes**, not as interleaved per-step records:

```text
[ progress: Float32 × N ][ x: Float32 × N ][ y: Float32 × N ]
[ speed: Float32 × N ][ status: Uint8 × N ]
```

where `N = driverCount × 300` and each plane is in `[driver][step]` order.

- `progress` — within-lap progress in `0..100`, resetting at the start/finish line.
- `x`, `y` — track coordinates.
- `speed` — km/h.
- `status` — `0` running, `1` in pit, `2` out/retired.

Total chunk size: `driverCount × 300 × 17` bytes.

### Gaps file

`gaps.bin` stores `[driver][lap][checkpoint]` as little-endian `Uint32` crossing times, with 100 checkpoints per lap. Drivers are indexed in `manifest.driverOrder` order, matching the motion chunks. Crossing times are lap-relative, not the cumulative race clock, and are derived deterministically from each lap's duration and sector timings — this file is a fallback, not measured checkpoint telemetry. The sentinel `0xFFFFFFFF` means the lap or checkpoint was never completed.

The replay engine prefers the `laps` table and only falls back to `gaps.bin` when a session has no lap timing, so the web app skips downloading it for normal races.

### Track geometry

`track.json` contains an `outline` point list, `sector1`/`sector2`/`sector3` boundary runs (`outer` plus optional `inner`), and a `bounds` object. See the format reference for the exact schema.

> [!NOTE]
> `manifest.trackLengthM` is currently written with a placeholder value by the ETL and is not used for map rendering. The track outline itself is derived from telemetry when available.

---

## Replay engine

`web/src/engine.ts` is the heart of the replay:

1. The manifest defines `sampleHz`, `chunkSeconds`, `chunkCount`, `driverOrder` and `durationMs`.
2. `RaceEngine` requests only the chunks needed for the current playhead and prefetches the next two.
3. `decodeMotionChunk` converts each `ArrayBuffer` into typed arrays using the shared layout constants.
4. Samples are linearly interpolated between adjacent 5 Hz steps and across chunk boundaries.
5. An 8-entry LRU cache keeps recently used chunks in memory.
6. A `requestAnimationFrame` loop advances the engine; playback speed is applied per frame.
7. The playhead lives in the engine, not in Redux. Only speed and play/pause state are stored in Redux, while seek/rewind intents are forwarded to the engine through a listener middleware.
8. The track map subscribes to engine snapshots and redraws imperatively on canvas, avoiding a React render on every animation frame.

This separation keeps scrubbing and 60 fps playback independent of Redux update frequency.

---

## Configuration

| Variable | Default | Used by | Description |
|----------|---------|---------|-------------|
| `DATA_ROOT` | `./data` | API, ETL | Root containing the `sessions/` directory |
| `API_PORT` | `3001` | API | HTTP port |
| `VITE_API_BASE_URL` | *(empty)* | Web | Optional absolute API origin; empty keeps requests relative |

Notes:

- The ETL resolves `DATA_ROOT` relative to the current working directory; the API resolves a relative `DATA_ROOT` against the repository root. Run both from the repository root to keep them aligned.
- The Vite dev proxy is hard-coded to `http://localhost:3001` in `web/vite.config.ts`.
- Tests set `VITE_API_BASE_URL=http://localhost` so MSW can intercept requests.

---

## Testing and quality checks

```bash
npm test          # shared + API + web
npm run typecheck # all workspaces
npm run lint      # ESLint
```

The suite currently contains **119 tests**:

- **`shared` (6)** — schema validation and binary decoder invariants.
- **`api` (38)** — route behavior, caching, error handling and path-traversal protection against a real on-disk fixture.
- **`web` (75)** — engine behavior, playback bridge, leaderboard logic, race picker states and track-map rendering.

API tests build a temporary session directory from `api/tests/fixture.ts`, so no generated data is required to run them. Web tests use jsdom, Testing Library and MSW.

`npm run validate:data` performs a lightweight integrity pass over every processed session:

```bash
npm run validate:data
```

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Race picker says “No races processed yet” | Ingest at least one race, then reload the page. |
| API returns `404` for a session that exists on disk | `DATA_ROOT` differs between the ETL and API processes. Run both from the repo root or set an absolute path. |
| Race opens without replay panels | The session is `results` tier — no motion chunks were produced or `availableLayers` does not include `motion`. |
| Port `3001` is already in use | Set `API_PORT` and update the Vite proxy target in `web/vite.config.ts`. |
| First ingest is very slow | OpenF1 telemetry is fetched per driver and rate-limited. Let it finish; later runs reuse `etl/.cache/openf1/`. |
| Upstream returns `429` | The client throttles and retries automatically. Re-run later if retries are exhausted. |
| Web requests fail with a CORS error | Access the app through Vite or put the web assets and API behind the same origin/reverse proxy. |
| Track map is a rectangle | No usable position telemetry was found, so the ETL fell back to its placeholder circuit shape. |

---

## Known limitations

- The web UI is built around **Race** sessions; Qualifying and Sprint are accepted by parts of the ETL but are not exposed as first-class views.
- The “Strategy & stints” panel is a placeholder in the race layout.
- Only sessions containing `data.sqlite` are listed; artifacts are not watched for changes at runtime, so refresh or restart after a re-ingest.
- `trackLengthM` is placeholder metadata, and driver `name` values are currently populated from driver codes.
- `gaps.bin` is derived from lap and sector timing rather than measured checkpoint telemetry, and is used only as a fallback when a session has no lap timing.
- Event ingestion is best-effort; some sessions may have an empty or partial `events` table, in which case scrubber markers are omitted.
- There is no authentication and no write API. Deploy it as an internal or read-only service.

---

## Documentation

- [`docs/FORMAT.md`](docs/FORMAT.md) — session directory layout, SQLite tables, manifest, track and binary formats.
- [`docs/ROUTES.md`](docs/ROUTES.md) — complete HTTP API reference, response schemas and error behavior.

---

## Contributing

Before opening a pull request:

```bash
npm test
npm run typecheck
npm run lint
npm run validate:data
```

Keep shared contracts in `shared/`, validate new API payloads with Zod, and add tests alongside behavior changes.

---

## License

No license file is currently included in this repository. Add one before distributing or reusing the project publicly.
