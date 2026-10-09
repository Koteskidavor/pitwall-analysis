# FORMAT: Pitwall Data File Formats

## File Structure

The ETL pipeline creates a session directory under `DATA_ROOT/sessions/{year}_{round}_{session_name}/` containing:

- `data.sqlite` - SQLite database with session metadata, laps, stints, pit stops, events
- `manifest.json` - JSON manifest describing the session
- `track.json` - JSON track outline data
- `motion/` directory - binary motion chunk files (5 Hz, 60 s per chunk)
- `gaps.bin` - binary gap crossing time data

---

## manifest.json

```json
{
  "schemaVersion": "1.0.0",
  "sampleHz": 5,
  "chunkSeconds": 60,
  "driverOrder": ["DRV1", "DRV2", ...],
  "chunkCount": 6,
  "trackLengthM": 3000,
  "durationMs": 3600000,
  "availableLayers": ["motion", "gaps"]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `schemaVersion` | `string` | Always `"1.0.0"` |
| `sampleHz` | `number` | Sampling rate in Hz (always `5`) |
| `chunkSeconds` | `number` | Chunk duration in seconds (always `60`) |
| `driverOrder` | `array[string]` | List of driver codes in order |
| `chunkCount` | `number` | Number of motion chunks (= ceil(duration_ms / 60000)) |
| `trackLengthM` | `number` | Track length in metres |
| `durationMs` | `number` | Total session duration in milliseconds |
| `availableLayers` | `array[string]` | Always `["motion", "gaps"]` |

---

## motion.bin (per chunk)

Files: `motion/000.bin`, `motion/001.bin`, ..., `motion/NNN.bin`

Each chunk file is **10,200 bytes** for 2 drivers (scales with driver count).

**Binary layout per chunk** (field-by-field, `[driver][step]` order):

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `progress` | `Float32` | `driverCount * 300 * 4` | Progress (0-100) per driver per step, non-decreasing |
| `x` | `Float32` | `driverCount * 300 * 4` | X coordinate per driver per step |
| `y` | `Float32` | `driverCount * 300 * 4` | Y coordinate per driver per step |
| `speed` | `Float32` | `driverCount * 300 * 4` | Speed in km/h per driver per step |
| `status` | `Uint8` | `driverCount * 300 * 1` | Status byte: 0=running, 1=pit, 2=out |

**Per-step layout** (17 bytes per step per driver):
- Bytes 0-3: `progress` (Float32, little-endian)
- Bytes 4-7: `x` (Float32, little-endian)
- Bytes 8-11: `y` (Float32, little-endian)
- Bytes 12-15: `speed` (Float32, little-endian)
- Byte 16: `status` (Uint8)

**Total per chunk**: `driverCount * 300 * 17` bytes

- Chunk 0: all cars start with `status=0` (running)
- Chunks 1+: cars that have completed the race have `status=2` (out)
- Progress is monotonic non-decreasing per driver (enforced via running maximum)

---

## gaps.bin

File: `gaps.bin`

**Binary layout**: `[driver][lap][checkpoint]` as `Uint32` milliseconds.

- **Entry size**: 4 bytes (Uint32, little-endian)
- **Checkpoints per lap**: 100 evenly spaced points
- **Value `0xFFFFFFFF`**: indicates checkpoint not crossed
- **Gap times are monotonic** per driver per lap (strictly increasing for crossed checkpoints)

**Size**: `driverCount * lapCount * 100 * 4` bytes

Example: 2 drivers * 50 laps * 100 checkpoints * 4 bytes = **40,000 bytes**

Per-entry meanings:
- Valid value: crossing time in milliseconds since lights-out
- `0xFFFFFFFF`: not crossed (e.g., lapped off-track, retired)

---

## data.sqlite

SQLite database with tables:
- `sessions` - session metadata (id, year, round, type, name, track, schema_version, status, processed_at)
- `drivers` - driver information (id, code, name, nationality)
- `laps` - lap data (time_ms, s1_ms, s2_ms, s3_ms, position, compound, tyre_age, ...)
- `stints` - tyre stint data (driver_id, lapStart, lapEnd, compound, tyreAgeAtStart)
- `pit_stops` - pit stop data (driver_id, lap, time_ms, duration_ms)
- `events` - session events (id, timestamp_ms, type, driver_id, message)

All times are milliseconds since lights-out. Lap data uses explicit `lap_time_ms` (duration), `lap_start_ms` and `lap_end_ms`.

---

## File size examples (2 drivers, 50 laps, 360s duration)

| File | Size |
|------|------|
| `data.sqlite` | ~2-5 MB (depends on laps data) |
| `manifest.json` | ~1 KB |
| `track.json` | ~2 KB |
| `motion/000.bin` ... `motion/005.bin` | 10,200 bytes each (6 chunks * 10,200 = 61,200 total) |
| `gaps.bin` | 40,000 bytes (2 drivers * 50 laps * 100 checkpoints * 4 bytes) |
| **Total** | ~65-70 MB |