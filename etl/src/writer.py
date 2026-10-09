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
from paths import DATA_ROOT, race_dir, manifest_path, track_path, motion_path, gaps_path
from fetch import fetch_session, get_driver_order, time_to_ms, get_event_data
from clean import clean_laps, clean_stints, clean_pit_stops
from strategy import calculate_strategy, compute_pit_loss
from events import extract_events
import pandas as pd
import fastf1
from motion import generate_motion_data
from gaps import generate_gaps_data


def write_sqlite(year: int, round: int, session_name: str, driver_count: int = None) -> str:
    """Fetch a race and write all data to SQLite. Returns the session id."""
    session = fetch_session(year, round, session_name)
    session.load()

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
    cursor = conn.cursor()

    # Create tables
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            year INTEGER,
            round INTEGER,
            type TEXT,
            name TEXT,
            track TEXT,
            schema_version TEXT,
            status TEXT,
            processed_at TEXT
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS drivers (
            id TEXT PRIMARY KEY,
            code TEXT,
            name TEXT,
            nationality TEXT
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS laps (
            time_ms INTEGER,
            s1_ms INTEGER,
            s2_ms INTEGER,
            s3_ms INTEGER,
            position INTEGER,
            compound TEXT,
            tyre_age INTEGER,
            is_accurate INTEGER,
            is_pit_in INTEGER,
            is_pit_out INTEGER,
            driver_id TEXT,
            lap INTEGER,
            PRIMARY KEY (driver_id, lap)
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS stints (
            driver_id TEXT,
            lapStart INTEGER,
            lapEnd INTEGER,
            compound TEXT,
            tyreAgeAtStart INTEGER,
            PRIMARY KEY (driver_id, lapStart)
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS pit_stops (
            driver_id TEXT,
            lap INTEGER,
            time_ms INTEGER,
            duration_ms INTEGER,
            PRIMARY KEY (driver_id, lap)
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS events (
            id TEXT,
            timestamp_ms INTEGER,
            type TEXT,
            driver_id TEXT,
            message TEXT
        )
    ''')

# Write session metadata
    processed_at = datetime.now().isoformat()
    cursor.execute('''
        INSERT OR REPLACE INTO sessions (id, year, round, type, name, track, schema_version, status, processed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        session_id,
        year,
        round,
        session.name,       # type
        session.name,       # name
        'Bahrain',          # track - placeholder, will be fixed
        '1.0.0',           # schema_version
        'ready',           # status
        processed_at
    ))

    # Write drivers
    # driver_order already obtained from get_driver_order(session)
    for i, driver_code in enumerate(driver_order):
        # Use the driver code as both id and code
        cursor.execute('''
            INSERT OR REPLACE INTO drivers (id, code, name, nationality)
            VALUES (?, ?, ?, ?)
        ''', (
            driver_code,
            driver_code,
            driver_code,  # code = driver code
            None  # nationality - will be filled from results if needed
        ))

    # Write laps
    laps_data = session.laps
    if not laps_data.empty:
        for _, lap in laps_data.iterrows():
            cursor.execute('''
                INSERT OR REPLACE INTO laps (time_ms, s1_ms, s2_ms, s3_ms, position, compound, tyre_age, is_accurate, is_pit_in, is_pit_out, driver_id, lap)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                time_to_ms(lap['Time']),
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

    # Write stints (extract from laps Stint column if available)
    stint_data = None
    if 'Stint' in session.laps.columns:
        stint_df = session.laps[['Driver', 'Stint']].dropna().drop_duplicates()
        stint_data = stint_df
    if stint_data is not None and not stint_data.empty:
        for _, stint in stint_data.iterrows():
            driver_code = stint.get('Driver', '')
            lap_start = int(stint.get('Stint', 1))
            # Get lap end as the last lap in this stint
            driver_laps = session.laps[session.laps['Driver'] == driver_code]
            if not driver_laps.empty:
                lap_end = int(driver_laps['LapNumber'].max())
                compound = driver_laps['Compound'].iloc[0] if 'Compound' in driver_laps.columns else ''
                tyre_age = int(driver_laps['TyreLife'].max()) if 'TyreLife' in driver_laps.columns else 0
                cursor.execute('''
                    INSERT OR REPLACE INTO stints (driver_id, lapStart, lapEnd, compound, tyreAgeAtStart)
                    VALUES (?, ?, ?, ?, ?)
                ''', (driver_code, lap_start, lap_end, compound, tyre_age))

    # Write pit stops (extract from laps data)
    pit_laps = session.laps[session.laps['PitInTime'].notna()] if 'PitInTime' in session.laps.columns else pd.DataFrame()
    if not pit_laps.empty:
        for _, lap in pit_laps.iterrows():
            driver_code = lap.get('Driver', '')
            pit_lap = int(lap.get('LapNumber', 0))
            pit_duration = int(lap.get('PitInTime', 0).total_seconds() * 1000) if hasattr(lap.get('PitInTime', 0), 'total_seconds') else int(lap.get('PitInTime', 0))
            cursor.execute('''
                INSERT OR REPLACE INTO pit_stops (driver_id, lap, time_ms, duration_ms)
                VALUES (?, ?, ?, ?)
            ''', (driver_code, pit_lap, pit_duration, pit_duration))

    # Write events
    events_data = get_event_data(session)
    if events_data:
        for event in events_data:
            cursor.execute('''
                INSERT OR REPLACE INTO events (id, timestamp_ms, type, driver_id, message)
                VALUES (?, ?, ?, ?, ?)
            ''', (
                event.get('EventName', ''),
                event.get('Time', 0),
                event.get('EventType', ''),
                event.get('Driver', ''),
                event.get('Message', '')
            ))

    conn.commit()
    conn.close()

    return session_id


def write_manifest(year: int, round: int, session_name: str, driver_count: int = None) -> dict:
    """Write manifest.json for the race. Returns the manifest data."""
    session = fetch_session(year, round, session_name)
    session.load()

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
    duration_ms_val = int(session.laps['Time'].max().total_seconds() * 1000) if not session.laps.empty else 3600000
    chunk_count = int(np.ceil(duration_ms_val / 60000)) if duration_ms_val else 1

    manifest = {
        'schemaVersion': '1.0.0',
        'sampleHz': 5,
        'chunkSeconds': 60,
        'driverOrder': driver_order,
        'chunkCount': chunk_count,
        'trackLengthM': track_length,
        'durationMs': int(session.laps['Time'].max().total_seconds() * 1000) if not session.laps.empty else 3600000,
        'availableLayers': ['motion', 'gaps']
    }

    # Write manifest.json
    manifest_path_out = manifest_path(year, round, session_name)
    with open(manifest_path_out, 'w') as f:
        json.dump(manifest, f, indent=2)

    return manifest


def write_track(year: int, round: int, session_name: str) -> dict:
    """Write track.json for the race. Returns the track data."""
    session = fetch_session(year, round, session_name)
    session.load()

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

    track_data = {
        'outline': outline,
        'sector1': {'outer': outline, 'inner': None},
        'sector2': {'outer': outline, 'inner': None},
        'bounds': {'x': 0, 'y': 0}
    }

    # Write track.json
    track_path_out = track_path(year, round, session_name)
    with open(track_path_out, 'w') as f:
        json.dump(track_data, f, indent=2)

    return track_data


def write_race(year: int, round: int, session_name: str, driver_count: int = None) -> str:
    """Full race write: SQLite, manifest.json, track.json, motion.bin, gaps.bin. Returns session id."""
    session_id = write_sqlite(year, round, session_name, driver_count)

    # Generate and write motion data
    session = fetch_session(year, round, session_name)
    session.load()
    driver_order = get_driver_order(session)
    if driver_count:
        driver_order = driver_order[:driver_count]

    session.load()
    circuit_info = session.get_circuit_info()
    outline = []
    if circuit_info and hasattr(circuit_info, 'corners'):
        corners = circuit_info.corners
        if len(corners) > 0:
            for _, row in corners.iterrows():
                outline.append({'x': float(row['X']), 'y': float(row['Y'])})

    if not outline:
        outline = [{'x': 0, 'y': 0}, {'x': 100, 'y': 0}, {'x': 100, 'y': 100}, {'x': 0, 'y': 100}]

    duration_ms = int(session.laps['Time'].max().total_seconds() * 1000) if not session.laps.empty else 3600000
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

    # Write motion chunks
    for chunk_idx in range(num_chunks):
        # For this chunk, extract steps [chunk_idx*step_count : (chunk_idx+1)*step_count]
        # For driver d, step s (within chunk): array index = d * total_steps + chunk_idx * step_count + s
        chunk_progress = np.zeros(driver_count * step_count, dtype=np.float32)
        chunk_x = np.zeros(driver_count * step_count, dtype=np.float32)
        chunk_y = np.zeros(driver_count * step_count, dtype=np.float32)
        chunk_speed = np.zeros(driver_count * step_count, dtype=np.float32)
        chunk_status = np.zeros(driver_count * step_count, dtype=np.uint8)

        for drv in range(driver_count):
            for s in range(step_count):
                abs_step = chunk_idx * step_count + s  # absolute step index across all chunks
                idx = drv * total_steps + abs_step  # index in the flat array
                chunk_progress[drv * step_count + s] = motion_data['progress'][idx]
                chunk_x[drv * step_count + s] = motion_data['x'][idx]
                chunk_y[drv * step_count + s] = motion_data['y'][idx]
                chunk_speed[drv * step_count + s] = motion_data['speed'][idx]
                chunk_status[drv * step_count + s] = int(motion_data['status'][idx])

# Pack binary: field-by-field layout [driver][step]
        # File structure: progress[drv0_step0, drv0_step1, ..., drv0_stepN, drv1_step0, drv1_step1, ..., drv1_stepN]
        #                 x[same layout], y[same layout], speed[same layout], status[same layout]
        # Each step per driver: 17 bytes total (4+4+4+4+1)
        # Progress/x/y/speed: Float32 (4 bytes each)
        # Status: Uint8 (1 byte each)
        # Total per chunk: driver_count * step_count * 17 bytes
        
        # Field offsets (byte position within buffer)
        PROG_BASE = 0
        X_BASE = driver_count * step_count * 4
        Y_BASE = 2 * driver_count * step_count * 4
        SPEED_BASE = 3 * driver_count * step_count * 4
        STATUS_BASE = 4 * driver_count * step_count  # after 4 Float32 fields
        
        total_bytes = driver_count * step_count * 17
        buffer = bytearray(total_bytes)
        
        # Write progress field (Float32, 4 bytes each)
        # Layout: [drv0_step0, drv0_step1, ..., drv0_stepN, drv1_step0, drv1_step1, ..., drv1_stepN]
        for drv in range(driver_count):
            for s in range(step_count):
                offset = PROG_BASE + (drv * step_count + s) * 4
                buffer[offset:offset+4] = np.float32(chunk_progress[drv * step_count + s]).tobytes()
        
        # Write x field (Float32)
        for drv in range(driver_count):
            for s in range(step_count):
                offset = X_BASE + (drv * step_count + s) * 4
                buffer[offset:offset+4] = np.float32(chunk_x[drv * step_count + s]).tobytes()
        
        # Write y field (Float32)
        for drv in range(driver_count):
            for s in range(step_count):
                offset = Y_BASE + (drv * step_count + s) * 4
                buffer[offset:offset+4] = np.float32(chunk_y[drv * step_count + s]).tobytes()
        
        # Write speed field (Float32)
        for drv in range(driver_count):
            for s in range(step_count):
                offset = SPEED_BASE + (drv * step_count + s) * 4
                buffer[offset:offset+4] = np.float32(chunk_speed[drv * step_count + s]).tobytes()
        
        # Write status field (Uint8, 1 byte each)
        # Status is a flat array after all Float32 fields
        for drv in range(driver_count):
            for s in range(step_count):
                offset = STATUS_BASE + (drv * step_count + s)
                buffer[offset] = chunk_status[drv * step_count + s]

        motion_file = motion_path(year, round, session_name, chunk_idx)
        with open(motion_file, 'wb') as f:
            f.write(buffer)

    # Generate and write gaps data
    laps_df = session.laps
    if not laps_df.empty:
        gaps_data = generate_gaps_data(laps_df, driver_count, int(laps_df['LapNumber'].max()), checkpoint_count=100)
    else:
        gaps_data = generate_gaps_data(pd.DataFrame(), driver_count, 1, checkpoint_count=100)

    # Write gaps.bin
    gaps_file = gaps_path(year, round, session_name)
    expected_gaps_bytes = driver_count * gaps_data['lapCount'] * gaps_data['checkpointCount'] * 4
    with open(gaps_file, 'wb') as f:
        f.write(gaps_data['crossingTimes'].tobytes()[:expected_gaps_bytes])

    # Update chunkCount in manifest
    write_manifest(year, round, session_name, driver_count=driver_count)
    write_track(year, round, session_name)

    return session_id