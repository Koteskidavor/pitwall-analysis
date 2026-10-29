import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path
import numpy as np
import os as _os
from pathlib import Path as _Path

# Import paths module - add etl/src to path if needed
import sys
if 'etl/src' not in sys.path:
    sys.path.insert(0, 'etl/src')
from paths import DATA_ROOT, race_dir, manifest_path, track_path, motion_path, gaps_path, CACHE_DIR
from fetch import fetch_session, get_driver_order, time_to_ms, get_event_data
import pandas as pd
import fastf1
from motion import (
    generate_motion_data,
    _get_lights_out_offset,
    _driver_telemetry,
    _time_value_to_ms,
    _times_to_ms,
)
from gaps import generate_gaps_data


def _session_date(session) -> str | None:
    """ISO date the session actually took place (not when it was processed).

    FastF1 exposes ``session.date``/``session.t0_date`` as a datetime while the
    OpenF1 source carries an ISO ``date_start`` string.
    """
    value = getattr(session, 'date', None) or getattr(session, 't0_date', None)
    if value is None:
        return None
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    return str(value)


def _session_name(session) -> str:
    """Official F1 event name for the session, e.g. ``Monaco Grand Prix``.

    FastF1 exposes it on ``session.event['EventName']`` while the OpenF1 source
    carries the meeting name. ``session.name`` is only the session type
    (``Race``) on both, so it is the last resort.
    """
    event = getattr(session, 'event', None)
    if isinstance(event, dict):
        for key in ('EventName', 'meeting_name'):
            value = event.get(key)
            if value:
                return str(value)
    meeting_name = getattr(session, 'meeting_name', None)
    if meeting_name:
        return str(meeting_name)
    return str(getattr(session, 'name', '') or '')


def write_sqlite(session, year: int, round: int, session_name: str, driver_count: int = None) -> str:
    """Fetch a race and write all data to SQLite. Returns the session id."""
    # Session is already loaded by caller

    driver_order = get_driver_order(session)
    if driver_count:
        driver_order = driver_order[:driver_count]

    race_dir_path = race_dir(year, round, session_name)
    race_dir_path.mkdir(parents=True, exist_ok=True)

    # Determine session id
    session_id = f"{year}_{round}_{session_name.replace(' ', '_')}"

    # Create SQLite database
    sqlite_path = Path(DATA_ROOT) / 'sessions' / session_id / 'data.sqlite'
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(sqlite_path))
    # Set PRAGMAs for better performance and reliability
    conn.execute("PRAGMA journal_mode=DELETE")  # WAL mode creates -shm files that break read-only opens
    conn.execute("PRAGMA synchronous=NORMAL")   # Good balance of safety and performance
    conn.execute("PRAGMA cache_size=10000")     # Increase cache size
    conn.execute("PRAGMA temp_store=MEMORY")    # Store temp tables in memory
    cursor = conn.cursor()

    # Create tables
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            year INTEGER NOT NULL,
            round INTEGER NOT NULL,
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            track TEXT NOT NULL,
            schema_version TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('ready', 'failed')),
            processed_at TEXT,
            session_date TEXT
        )
    ''')
    # Older databases predate the session_date column; add it in place so the
    # race's real date can be shown instead of the ETL processing time.
    existing_columns = {row[1] for row in cursor.execute('PRAGMA table_info(sessions)')}
    if 'session_date' not in existing_columns:
        cursor.execute('ALTER TABLE sessions ADD COLUMN session_date TEXT')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS drivers (
            id TEXT PRIMARY KEY,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            nationality TEXT
        )
    ''')
    # Index on driver code for fast lookups
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_drivers_code ON drivers(code)
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS laps (
            lap_time_ms INTEGER NOT NULL,
            lap_start_ms INTEGER NOT NULL,
            lap_end_ms INTEGER NOT NULL,
            s1_ms INTEGER,
            s2_ms INTEGER,
            s3_ms INTEGER,
            position INTEGER,
            compound TEXT,
            tyre_age INTEGER,
            is_accurate INTEGER NOT NULL CHECK(is_accurate IN (0, 1)),
            is_pit_in INTEGER NOT NULL CHECK(is_pit_in IN (0, 1)),
            is_pit_out INTEGER NOT NULL CHECK(is_pit_out IN (0, 1)),
            driver_id TEXT NOT NULL,
            lap INTEGER NOT NULL,
            PRIMARY KEY (driver_id, lap)
        )
    ''')
    # Indexes for common queries
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_laps_driver_lap ON laps(driver_id, lap)
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_laps_position ON laps(position) WHERE position > 0
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_laps_compound ON laps(compound) WHERE compound IS NOT NULL
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS stints (
            driver_id TEXT NOT NULL,
            lapStart INTEGER NOT NULL,
            lapEnd INTEGER NOT NULL,
            compound TEXT,
            tyreAgeAtStart INTEGER NOT NULL,
            PRIMARY KEY (driver_id, lapStart)
        )
    ''')
    # Index on driver_id for stints lookup
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_stints_driver ON stints(driver_id)
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS pit_stops (
            driver_id TEXT NOT NULL,
            lap INTEGER NOT NULL,
            time_ms INTEGER NOT NULL,
            duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0),
            PRIMARY KEY (driver_id, lap)
        )
    ''')
    # Index on driver_id for pit stops lookup
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_pit_stops_driver ON pit_stops(driver_id)
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS events (
            id TEXT NOT NULL,
            timestamp_ms INTEGER NOT NULL,
            type TEXT NOT NULL,
            driver_id TEXT,
            message TEXT
        )
    ''')
    # Index on timestamp for time-based queries
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp_ms)
    ''')
    # Index on driver_id for driver-specific events
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_events_driver ON events(driver_id) WHERE driver_id IS NOT NULL
    ''')
    
    # Create results table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS results (
            driver_id TEXT NOT NULL,
            position INTEGER,
            grid_position INTEGER,
            time_ms INTEGER,
            gap_ms INTEGER,
            points INTEGER DEFAULT 0,
            FOREIGN KEY (driver_id) REFERENCES drivers(id)
        )
    ''')
    # Index on position for fast lookup of race order
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_results_position ON results(position) WHERE position IS NOT NULL AND position > 0
    ''')
    # Index on driver_id for driver-specific results
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_results_driver ON results(driver_id)
    ''')
    
    # Set user version to track schema version
    cursor.execute("PRAGMA user_version = 1")

    # Write session metadata
    processed_at = datetime.now().isoformat()
    session_date = _session_date(session)
    try:
        track_name = str(session.event['Location'])
    except (KeyError, TypeError):
        track_name = str(getattr(session, 'name', 'unknown'))
    cursor.execute('''
        INSERT OR REPLACE INTO sessions (id, year, round, type, name, track, schema_version, status, processed_at, session_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        session_id,
        year,
        round,
        session.session_info['Type'],
        _session_name(session),  # official F1 event name, e.g. Monaco Grand Prix
        track_name,              # circuit location
        '1.0.0',           # schema_version
        'ready',           # status
        processed_at,
        session_date
    ))

    # Write drivers
    # driver_order already obtained from get_driver_order(session)
    drivers_data = [
        (driver_code, driver_code, driver_code, None)  # id, code, name, nationality
        for driver_code in driver_order
    ]
    cursor.executemany('''
        INSERT OR REPLACE INTO drivers (id, code, name, nationality)
        VALUES (?, ?, ?, ?)
    ''', drivers_data)

    # Write laps
    laps_data = session.laps
    if not laps_data.empty:
        # Get lights-out offset for timestamp conversion
        lights_out_ms = _get_lights_out_offset(session)
        
        # Prepare batch data for laps insertion
        laps_batch_data = []
        for _, lap in laps_data.iterrows():
            # Calculate lap time duration (LapTime)
            lap_time = lap.get('LapTime')
            if pd.isna(lap_time):
                lap_time_ms = 0
            else:
                if hasattr(lap_time, 'total_seconds'):
                    lap_time_ms = int(lap_time.total_seconds() * 1000)
                else:
                    lap_time_ms = int(lap_time)
            
            # Calculate lap start time (LapStartTime) offset to lights-out
            lap_start = lap.get('LapStartTime')
            if pd.isna(lap_start):
                lap_start_ms = 0
            else:
                if hasattr(lap_start, 'total_seconds'):
                    lap_start_ms = int(lap_start.total_seconds() * 1000) - lights_out_ms
                else:
                    lap_start_ms = int(lap_start) - lights_out_ms
            
            # Calculate lap end time (Time) offset to lights-out
            lap_end = lap.get('Time')
            if pd.isna(lap_end):
                lap_end_ms = 0
            else:
                if hasattr(lap_end, 'total_seconds'):
                    lap_end_ms = int(lap_end.total_seconds() * 1000) - lights_out_ms
                else:
                    lap_end_ms = int(lap_end) - lights_out_ms
            
            # Ensure non-negative times (clip to 0 if negative due to lights-out offset)
            lap_start_ms = max(0, lap_start_ms)
            lap_end_ms = max(0, lap_end_ms)
            
            laps_batch_data.append((
                lap_time_ms,
                lap_start_ms,
                lap_end_ms,
                time_to_ms(lap.get('S1Time')),
                time_to_ms(lap.get('S2Time')),
                time_to_ms(lap.get('S3Time')),
                lap.get('Position'),
                lap.get('Compound'),
                lap.get('TyreAge'),
                1 if lap.get('is_accurate', False) else 0,
                1 if lap.get('is_pit_in', False) else 0,
                1 if lap.get('is_pit_out', False) else 0,
                lap.get('Driver', ''),  # Use Driver column, not DriverId
                lap.get('LapNumber')
            ))
        
        # Batch insert all laps
        if laps_batch_data:
            cursor.executemany('''
                INSERT OR REPLACE INTO laps (lap_time_ms, lap_start_ms, lap_end_ms, s1_ms, s2_ms, s3_ms, position, compound, tyre_age, is_accurate, is_pit_in, is_pit_out, driver_id, lap)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', laps_batch_data)

    # Write stints (extract from laps data, grouped by Driver and Stint)
    if 'Stint' in session.laps.columns and not session.laps.empty:
        # Group by Driver and Stint
        stint_groups = session.laps.groupby(['Driver', 'Stint'])
        stints_batch_data = []
        for (driver_code, stint_num), stint_laps in stint_groups:
            # Sort laps by LapNumber to get first and last
            stint_laps_sorted = stint_laps.sort_values('LapNumber')
            lap_start = int(stint_laps_sorted['LapNumber'].iloc[0])  # First lap in stint
            lap_end = int(stint_laps_sorted['LapNumber'].iloc[-1])   # Last lap in stint
            # Compound and tyre age at start of stint (first lap)
            compound = stint_laps_sorted['Compound'].iloc[0] if 'Compound' in stint_laps_sorted.columns else ''
            tyre_age = int(stint_laps_sorted['TyreLife'].iloc[0]) if 'TyreLife' in stint_laps_sorted.columns else 0
            
            stints_batch_data.append((driver_code, lap_start, lap_end, compound, tyre_age))
        
        # Batch insert all stints
        if stints_batch_data:
            cursor.executemany('''
                INSERT OR REPLACE INTO stints (driver_id, lapStart, lapEnd, compound, tyreAgeAtStart)
                VALUES (?, ?, ?, ?, ?)
            ''', stints_batch_data)

        # Write pit stops (extract from laps data)
        pit_laps = session.laps[session.laps['PitInTime'].notna()] if 'PitInTime' in session.laps.columns else pd.DataFrame()
        if not pit_laps.empty:
            # Get lights-out offset for timestamp conversion
            lights_out_ms = _get_lights_out_offset(session)
            
            # Prepare batch data for pit stops insertion
            pit_batch_data = []
            for _, lap in pit_laps.iterrows():
                driver_code = lap.get('Driver', '')
                pit_lap = int(lap.get('LapNumber', 0))
                
                # Pit-in time (offset to lights-out)
                pit_in_time = lap.get('PitInTime')
                if pd.isna(pit_in_time):
                    pit_in_ms = 0
                else:
                    if hasattr(pit_in_time, 'total_seconds'):
                        pit_in_ms = int(pit_in_time.total_seconds() * 1000) - lights_out_ms
                    else:
                        pit_in_ms = int(pit_in_time) - lights_out_ms
                
                # Pit duration = PitOutTime - PitInTime
                pit_out_time = lap.get('PitOutTime')
                pit_duration_ms = 0
                if not pd.isna(pit_in_time) and not pd.isna(pit_out_time):
                    if hasattr(pit_in_time, 'total_seconds') and hasattr(pit_out_time, 'total_seconds'):
                        pit_in_sec = pit_in_time.total_seconds()
                        pit_out_sec = pit_out_time.total_seconds()
                        pit_duration_ms = int((pit_out_sec - pit_in_sec) * 1000)
                    else:
                        # Fallback if not timedelta objects
                        pit_duration_ms = int(pit_out_time) - int(pit_in_time)
                
                # Ensure non-negative
                pit_in_ms = max(0, pit_in_ms)
                pit_duration_ms = max(0, pit_duration_ms)
                
                pit_batch_data.append((driver_code, pit_lap, pit_in_ms, pit_duration_ms))
            
            # Batch insert all pit stops
            if pit_batch_data:
                cursor.executemany('''
                    INSERT OR REPLACE INTO pit_stops (driver_id, lap, time_ms, duration_ms)
                    VALUES (?, ?, ?, ?)
                ''', pit_batch_data)

    # Write events (clear first: this table has no primary key, so a re-ingest
    # would otherwise append duplicate rows).
    cursor.execute('DELETE FROM events')
    events_data = get_event_data(session)
    if events_data:
        # Prepare batch data for events insertion
        events_batch_data = []
        for event in events_data:
            events_batch_data.append((
                event.get('EventName', ''),
                event.get('Time', 0),
                event.get('EventType', ''),
                event.get('Driver', ''),
                event.get('Message', '')
            ))
        
        # Batch insert all events
        if events_batch_data:
            cursor.executemany('''
                INSERT OR REPLACE INTO events (id, timestamp_ms, type, driver_id, message)
                VALUES (?, ?, ?, ?, ?)
            ''', events_batch_data)

    # Write results (clear first: this table has no primary key, so a re-ingest
    # would otherwise append duplicate rows).
    cursor.execute('DELETE FROM results')
    if hasattr(session, 'results') and not session.results.empty:
        # Prepare batch data for results insertion
        results_batch_data = []
        for _, result in session.results.iterrows():
            driver_code = result.get('Abbreviation', '')
            position = result.get('Position')
            # Convert position to integer, handling None/NaN
            if pd.isna(position):
                position_int = None
            else:
                position_int = int(position)

            # Starting grid slot (may be absent, e.g. pit-lane starts)
            grid_val = result.get('GridPosition')
            if grid_val is None or pd.isna(grid_val):
                grid_int = None
            else:
                try:
                    grid_int = int(grid_val)
                except (ValueError, TypeError):
                    grid_int = None

            # Time (usually the total time or +X seconds behind winner)
            time_val = result.get('Time')
            time_ms = None
            if pd.notna(time_val):
                if hasattr(time_val, 'total_seconds'):
                    time_ms = int(time_val.total_seconds() * 1000)
                else:
                    time_ms = int(time_val)
            
            # Gap (time behind winner)
            gap_val = result.get('Gap')
            gap_ms = None
            if pd.notna(gap_val):
                if hasattr(gap_val, 'total_seconds'):
                    gap_ms = int(gap_val.total_seconds() * 1000)
                else:
                    gap_ms = int(gap_val)
            
            # Points (if available)
            points_val = result.get('Points')
            points = 0
            if pd.notna(points_val):
                try:
                    points = int(points_val)
                except (ValueError, TypeError):
                    points = 0
            
            results_batch_data.append((driver_code, position_int, grid_int, time_ms, gap_ms, points))
        
        # Batch insert all results
        if results_batch_data:
            cursor.executemany('''
                INSERT OR REPLACE INTO results (driver_id, position, grid_position, time_ms, gap_ms, points)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', results_batch_data)

    conn.commit()
    conn.close()

    return session_id


DEFAULT_SECTOR_FRACTIONS = (1 / 3, 2 / 3)


def _circuit_outline(session) -> list:
    """Return the fallback outline: circuit corners, then a rectangle."""
    outline = []
    try:
        circuit_info = session.get_circuit_info()
        if circuit_info is not None and hasattr(circuit_info, 'corners'):
            for _, row in circuit_info.corners.iterrows():
                outline.append({'x': float(row['X']), 'y': float(row['Y'])})
    except Exception:
        outline = []

    if not outline:
        outline = [{'x': 0, 'y': 0}, {'x': 100, 'y': 0}, {'x': 100, 'y': 100}, {'x': 0, 'y': 100}]
    return outline


def split_outline_into_sectors(outline: list, fractions: tuple) -> tuple:
    """Split a start-to-finish outline into the three sector point runs.

    Fractions are distances along the lap (0..1) where sectors 1 and 2 end.
    The shared boundary point is included in both neighbouring sectors so each
    sector can be drawn as a continuous polyline.
    """
    if len(outline) < 3:
        return outline, outline, outline

    last_index = len(outline) - 1
    first_split = min(max(int(round(fractions[0] * last_index)), 1), last_index - 1)
    second_split = min(
        max(int(round(fractions[1] * last_index)), first_split + 1), last_index
    )
    return (
        outline[: first_split + 1],
        outline[first_split : second_split + 1],
        outline[second_split:],
    )


def build_track_geometry(session, point_count: int = 180) -> tuple:
    """Build the outline and its exact OpenF1 sector splits.

    Sector boundaries come from the reference lap's sector timings
    (``S1Time``/``S2Time``) projected onto its position trace, so the map shows
    the same sector divisions as the timing feed rather than equal thirds.
    """
    geometry = _outline_and_sectors_from_telemetry(session, point_count)
    if geometry is None:
        outline = _circuit_outline(session)
        fractions = DEFAULT_SECTOR_FRACTIONS
    else:
        outline, fractions = geometry
    return outline, split_outline_into_sectors(outline, fractions)


def build_track_outline(session, point_count: int = 180) -> list:
    """Build the track centreline used for drawing and projections.

    Prefer a real racing line: resample the fastest accurate lap's position
    telemetry into a smooth closed loop. Fall back to FastF1's corner list,
    then to a rectangle, if telemetry is unavailable.
    """
    outline, _ = build_track_geometry(session, point_count)
    return outline


def _sector_fractions(lap, times: np.ndarray, x: np.ndarray, y: np.ndarray) -> tuple:
    """Return the fractions of the lap where sectors 1 and 2 end.

    The OpenF1 lap feed provides sector durations but no boundary coordinates.
    Interpolating those boundary times onto the lap's cumulative distance gives
    the exact point on the racing line where each sector changes.
    """
    start = _time_value_to_ms(lap.get('LapStartTime'))
    sector1 = _time_value_to_ms(lap.get('S1Time'))
    sector2 = _time_value_to_ms(lap.get('S2Time'))
    if start is None or sector1 is None or sector2 is None:
        return DEFAULT_SECTOR_FRACTIONS
    if times.size < 2 or times[-1] <= times[0]:
        return DEFAULT_SECTOR_FRACTIONS

    cumulative = np.concatenate(
        [[0.0], np.cumsum(np.hypot(np.diff(x), np.diff(y)))]
    )
    total = cumulative[-1]
    if total <= 0:
        return DEFAULT_SECTOR_FRACTIONS

    def fraction_at(timestamp_ms: float) -> float:
        distance = np.interp(timestamp_ms, times, cumulative)
        return float(distance / total)

    first = fraction_at(start + sector1)
    second = fraction_at(start + sector1 + sector2)
    if not (0.0 < first < second < 1.0):
        return DEFAULT_SECTOR_FRACTIONS
    return first, second


def _outline_and_sectors_from_telemetry(session, point_count: int = 180):
    try:
        laps = session.laps
    except Exception:
        return None
    if laps is None or laps.empty or 'LapTime' not in laps.columns:
        return None

    candidates = laps.dropna(subset=['LapTime'])
    if 'is_accurate' in candidates.columns:
        accurate = candidates[candidates['is_accurate']]
        if not accurate.empty:
            candidates = accurate
    if candidates.empty:
        return None

    # Walk the laps fastest-first and use the first one whose telemetry window
    # actually holds samples. Some feeds (e.g. a race red-flagged before the
    # end) only carry position data for part of the session, so the outright
    # fastest lap can have no telemetry while earlier laps still trace the
    # circuit. Falling through to a usable lap is what keeps the map correct.
    telemetry_cache: dict = {}
    for _, fastest in candidates.sort_values('LapTime').iterrows():
        start = _time_value_to_ms(fastest.get('LapStartTime'))
        end = _time_value_to_ms(fastest.get('Time'))
        driver_num = fastest.get('DriverNumber')
        if start is None or end is None or end <= start or driver_num is None:
            continue

        if driver_num not in telemetry_cache:
            telemetry_cache[driver_num] = _driver_telemetry(session.pos_data, driver_num)
        telemetry = telemetry_cache[driver_num]
        if telemetry.empty or 'X' not in telemetry.columns:
            continue

        times = _times_to_ms(telemetry['Time'])
        mask = (times >= start) & (times <= end)
        if int(mask.sum()) < 10:
            continue

        x = np.asarray(telemetry['X'].values[mask], dtype=np.float64)
        y = np.asarray(telemetry['Y'].values[mask], dtype=np.float64)
        # Feeds pad missing telemetry with (0, 0); a lap made only of those
        # points would collapse the outline to a dot.
        if not (np.any(x) or np.any(y)):
            continue

        outline = _resample_outline(x, y, point_count)
        if outline:
            return outline, _sector_fractions(fastest, times[mask], x, y)

    return None


def _resample_outline(x: np.ndarray, y: np.ndarray, point_count: int) -> list:
    """Resample a point trace by cumulative arclength so points are evenly spaced."""
    if x.size < 2 or y.size < 2:
        return []

    distances = np.hypot(np.diff(x), np.diff(y))
    cumulative = np.concatenate([[0.0], np.cumsum(distances)])
    total = cumulative[-1]
    if total <= 0:
        return []

    targets = np.linspace(0.0, total, point_count)
    resampled_x = np.interp(targets, cumulative, x)
    resampled_y = np.interp(targets, cumulative, y)
    return [
        {'x': float(px), 'y': float(py)}
        for px, py in zip(resampled_x, resampled_y)
    ]


def write_manifest(session, year: int, round: int, session_name: str, driver_count: int = None) -> dict:
    """Write manifest.json for the race. Returns the manifest data."""
    # Session is already loaded by caller

    driver_order = get_driver_order(session)
    if driver_count:
        driver_order = driver_order[:driver_count]

    # Get track outline from circuit info
    circuit_info = session.get_circuit_info()
    outline = []
    if circuit_info and hasattr(circuit_info, 'corners'):
        corners = circuit_info.corners
        if len(corners) > 0:
            for _, row in corners.iterrows():
                outline.append({'x': float(row['X']), 'y': float(row['Y'])})

    # If no circuit info, create a simple rectangle
    if not outline:
        outline = [{'x': 0, 'y': 0}, {'x': 100, 'y': 0}, {'x': 100, 'y': 100}, {'x': 0, 'y': 100}]

    # Get track length from circuit info
    track_length = 1000  # default
    if circuit_info is not None and hasattr(circuit_info, 'total_lap_time'):
        track_length = 300  # placeholder

    # Compute chunk count: 60-second chunks at 5 Hz
    lights_out_ms = _get_lights_out_offset(session)
    # Get race end timestamp (last lap end time) and convert to duration from lights-out
    if not session.laps.empty:
        last_lap_end = session.laps['Time'].max()
        if hasattr(last_lap_end, 'total_seconds'):
            duration_ms_val = int(last_lap_end.total_seconds() * 1000) - lights_out_ms
        else:
            duration_ms_val = int(last_lap_end) - lights_out_ms
        # Ensure non-negative
        duration_ms_val = max(0, duration_ms_val)
    else:
        duration_ms_val = 3600000  # 1 hour default
    chunk_count = int(np.ceil(duration_ms_val / 60000)) if duration_ms_val else 1
    lap_count = int(session.laps['LapNumber'].max()) if not session.laps.empty else 0

    manifest = {
        'schemaVersion': '1.0.0',
        'sampleHz': 5,
        'chunkSeconds': 60,
        'driverOrder': driver_order,
        'chunkCount': chunk_count,
        'lapCount': lap_count,
        'trackLengthM': track_length,
        'durationMs': duration_ms_val,
        'availableLayers': ['motion', 'gaps']
    }

    # Write manifest.json
    manifest_path_out = manifest_path(year, round, session_name)
    # Write to temporary file first, then atomically rename
    temp_manifest_path = manifest_path_out.with_suffix('.tmp')
    with open(temp_manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    temp_manifest_path.replace(manifest_path_out)  # Atomic rename

    return manifest


def write_track(session, year: int, round: int, session_name: str) -> dict:
    """Write track.json for the race. Returns the track data."""
    # Session is already loaded by caller

    outline, sectors = build_track_geometry(session)

    track_data = {
        'outline': outline,
        'sector1': {'outer': sectors[0], 'inner': None},
        'sector2': {'outer': sectors[1], 'inner': None},
        'sector3': {'outer': sectors[2], 'inner': None},
        'bounds': {'x': 0, 'y': 0}
    }

    # Write track.json
    track_path_out = track_path(year, round, session_name)
    # Write to temporary file first, then atomically rename
    temp_track_path = track_path_out.with_suffix('.tmp')
    with open(temp_track_path, 'w') as f:
        json.dump(track_data, f, indent=2)
    temp_track_path.replace(track_path_out)  # Atomic rename

    return track_data


def write_race(year: int, round: int, session_name: str, driver_count: int = None, lap_count: int = None) -> str:
    """Full race write: SQLite, manifest.json, track.json, motion.bin, gaps.bin. Returns session id."""
    # Enable FastF1 cache
    fastf1.Cache.enable_cache(CACHE_DIR)
    
    # Fetch and load session once
    session = fetch_session(year, round, session_name)
    session.load()
    
    # Apply lap count limit if specified
    if lap_count is not None and lap_count > 0:
        # Limit laps to the first 'lap_count' laps (sorted by lap number)
        if not session.laps.empty:
            session.laps = session.laps.sort_values('LapNumber').head(lap_count)
    
    session_id = write_sqlite(session, year, round, session_name, driver_count)

    # Generate and write motion data
    driver_order = get_driver_order(session)
    if driver_count:
        driver_order = driver_order[:driver_count]

    session.load()  # Already loaded, but calling again is cheap/harmless
    outline = build_track_outline(session)

    # Motion is authored on a lights-out-relative timeline (engine time 0 = race
    # start), so measure the duration from lights-out rather than the absolute
    # session clock. This must match the manifest written by write_manifest().
    lights_out_ms = _get_lights_out_offset(session)
    if not session.laps.empty:
        duration_ms = int(session.laps['Time'].max().total_seconds() * 1000) - lights_out_ms
    else:
        duration_ms = 3600000
    duration_ms = max(0, duration_ms)
    motion_data = generate_motion_data(session, driver_order, outline, duration_ms, sample_hz=5)

    race_dir_path = race_dir(year, round, session_name)
    motion_dir = Path(race_dir_path, 'motion')
    motion_dir.mkdir(parents=True, exist_ok=True)

    sample_hz = motion_data['sampleHz']
    chunk_seconds = motion_data['chunkSeconds']
    num_chunks = motion_data['numChunks']
    driver_count = motion_data['driverCount']
    step_count = sample_hz * chunk_seconds  # 300
    total_steps = step_count * num_chunks  # total steps across all chunks

    # Reshape motion data from flat [driver*total_steps] to [driver, total_steps] for easier chunk extraction
    progress_2d = motion_data['progress'].reshape((driver_count, total_steps))
    x_2d = motion_data['x'].reshape((driver_count, total_steps))
    y_2d = motion_data['y'].reshape((driver_count, total_steps))
    speed_2d = motion_data['speed'].reshape((driver_count, total_steps))
    status_2d = motion_data['status'].reshape((driver_count, total_steps))

    # Write motion chunks
    for chunk_idx in range(num_chunks):
        # Extract chunk data for this chunk: steps [chunk_idx*step_count : (chunk_idx+1)*step_count]
        start_step = chunk_idx * step_count
        end_step = start_step + step_count
        
        # Extract data for all drivers at once using slicing
        chunk_progress = progress_2d[:, start_step:end_step]  # Shape: [driver_count, step_count]
        chunk_x = x_2d[:, start_step:end_step]
        chunk_y = y_2d[:, start_step:end_step]
        chunk_speed = speed_2d[:, start_step:end_step]
        chunk_status = status_2d[:, start_step:end_step].astype(np.uint8)

        # Pack binary: field-plane layout, each plane in [driver][step] order.
        # File structure: progress[drv0_step0..drv0_stepN, drv1_step0..drv1_stepN, ...]
        #                 x[same layout], y[same layout], speed[same layout], status[same layout]
        # Each step per driver: 17 bytes total (4+4+4+4+1)
        # Progress/x/y/speed: Float32 (4 bytes each)
        # Status: Uint8 (1 byte each)
        # Total per chunk: driver_count * step_count * 17 bytes

        # Field offsets (byte position within buffer)
        element_count = driver_count * step_count
        PROG_BASE = 0
        X_BASE = element_count * 4
        Y_BASE = 2 * element_count * 4
        SPEED_BASE = 3 * element_count * 4
        STATUS_BASE = 4 * element_count * 4  # after 4 Float32 planes (4 * element_count * 4 bytes)

        total_bytes = element_count * 17
        buffer = bytearray(total_bytes)

        # chunk_* are [driver_count, step_count]; .flatten() keeps [driver][step] order.
        progress_flat = chunk_progress.flatten()
        progress_bytes = progress_flat.astype(np.float32).tobytes()
        buffer[PROG_BASE:PROG_BASE + len(progress_bytes)] = progress_bytes

        # Write x field (Float32)
        x_flat = chunk_x.flatten()
        x_bytes = x_flat.astype(np.float32).tobytes()
        buffer[X_BASE:X_BASE + len(x_bytes)] = x_bytes

        # Write y field (Float32)
        y_flat = chunk_y.flatten()
        y_bytes = y_flat.astype(np.float32).tobytes()
        buffer[Y_BASE:Y_BASE + len(y_bytes)] = y_bytes

        # Write speed field (Float32)
        speed_flat = chunk_speed.flatten()
        speed_bytes = speed_flat.astype(np.float32).tobytes()
        buffer[SPEED_BASE:SPEED_BASE + len(speed_bytes)] = speed_bytes

        # Write status field (Uint8, 1 byte each)
        status_flat = chunk_status.flatten()
        status_bytes = status_flat.tobytes()
        buffer[STATUS_BASE:STATUS_BASE + len(status_bytes)] = status_bytes

        motion_file = motion_path(year, round, session_name, chunk_idx)
        # Write to temporary file first, then atomically rename
        temp_motion_file = motion_file.with_suffix('.tmp')
        with open(temp_motion_file, 'wb') as f:
            f.write(buffer)
        temp_motion_file.replace(motion_file)  # Atomic rename

    # Generate and write gaps data
    laps_df = session.laps
    if not laps_df.empty:
        gaps_data = generate_gaps_data(laps_df, driver_count, int(laps_df['LapNumber'].max()), checkpoint_count=100)
    else:
        gaps_data = generate_gaps_data(pd.DataFrame(), driver_count, 1, checkpoint_count=100)

    # Write gaps.bin
    gaps_file = gaps_path(year, round, session_name)
    expected_gaps_bytes = driver_count * gaps_data['lapCount'] * gaps_data['checkpointCount'] * 4
    # Write to temporary file first, then atomically rename
    temp_gaps_file = gaps_file.with_suffix('.tmp')
    with open(temp_gaps_file, 'wb') as f:
        f.write(gaps_data['crossingTimes'].tobytes()[:expected_gaps_bytes])
    temp_gaps_file.replace(gaps_file)  # Atomic rename

    # Update chunkCount in manifest
    write_manifest(session, year, round, session_name, driver_count=driver_count)
    write_track(session, year, round, session_name)

    return session_id