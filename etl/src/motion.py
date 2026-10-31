import numpy as np
import pandas as pd
import os
import sys

# Add etl/src to path for paths module
if 'etl/src' not in sys.path:
    sys.path.insert(0, 'etl/src')
from paths import *


def track_outline_to_points(track_outline: list) -> np.ndarray:
    """Normalise a track outline into an (n, 2) float32 array.

    The ETL writes outlines as ``{"x": .., "y": ..}`` dicts (see track.json),
    but callers may also pass ``[x, y]`` sequences. Accept both.
    """
    if not track_outline:
        return np.empty((0, 2), dtype=np.float32)

    points = []
    for point in track_outline:
        if isinstance(point, dict):
            points.append((point['x'], point['y']))
        else:
            points.append((point[0], point[1]))
    return np.array(points, dtype=np.float32)


def precompute_track_arclength(track_outline: list) -> tuple:
    """Precompute cumulative arclength along track outline.
    
    Returns (segment_vectors, segment_lengths, cumulative_lengths, total_length)
    """
    if not track_outline or len(track_outline) < 2:
        return np.array([]), np.array([]), np.array([0.0]), 0.0
    
    pts = track_outline_to_points(track_outline)
    seg_vecs = pts[1:] - pts[:-1]
    seg_lens = np.hypot(seg_vecs[:, 0], seg_vecs[:, 1])
    cum_lens = np.zeros(len(seg_lens) + 1, dtype=np.float32)
    cum_lens[1:] = np.cumsum(seg_lens)
    total_len = float(cum_lens[-1])
    return seg_vecs, seg_lens, cum_lens, total_len


def project_onto_track_vectorized(x: np.ndarray, y: np.ndarray, 
                                   seg_vecs: np.ndarray, seg_lens: np.ndarray, 
                                   cum_lens: np.ndarray) -> np.ndarray:
    """Vectorized projection of (x, y) points onto track outline.
    
    Args:
        x, y: Arrays of shape (n_points,) or scalars
        seg_vecs: (n_segments, 2) segment vectors
        seg_lens: (n_segments,) segment lengths
        cum_lens: (n_segments + 1,) cumulative arclengths
    
    Returns:
        progress: Array of shape (n_points,) with distance along track
    """
    x = np.asarray(x, dtype=np.float32)
    y = np.asarray(y, dtype=np.float32)
    scalar_input = x.ndim == 0
    if scalar_input:
        x = x[None]
        y = y[None]
    
    n_points = x.shape[0]
    n_segs = seg_vecs.shape[0]
    
    if n_segs == 0:
        return np.zeros(n_points, dtype=np.float32)
    
    # Build segment start points from segment vectors
    seg_starts = np.zeros((n_segs, 2), dtype=np.float32)
    for i in range(1, n_segs):
        seg_starts[i] = seg_starts[i-1] + seg_vecs[i-1]
    
    pts = np.stack([x, y], axis=1)  # (n_points, 2)
    
    # Compute vectors from segment starts to points: (n_points, n_segments, 2)
    vecs = pts[:, None, :] - seg_starts[None, :, :]
    
    # Project onto segment vectors
    seg_lens_sq = seg_lens ** 2
    seg_lens_sq[seg_lens_sq == 0] = 1.0  # avoid div by zero
    t = np.sum(vecs * seg_vecs[None, :, :], axis=2) / seg_lens_sq[None, :]
    t = np.clip(t, 0.0, 1.0)
    
    # Projected points
    proj = seg_starts[None, :, :] + t[:, :, None] * seg_vecs[None, :, :]
    
    # Distances
    dists = np.linalg.norm(pts[:, None, :] - proj, axis=2)  # (n_points, n_segments)
    
    # Best segment per point
    best_seg = np.argmin(dists, axis=1)
    
    # Progress = cumulative length up to best segment + offset along segment
    offsets = t[np.arange(n_points), best_seg] * seg_lens[best_seg]
    progress = cum_lens[best_seg] + offsets
    
    if scalar_input:
        return progress[0]
    return progress


def project_onto_track(x: float, y: float, track_outline: list) -> float:
    """Project single x,y onto track outline to get progress (distance along track)."""
    seg_vecs, seg_lens, cum_lens, _ = precompute_track_arclength(track_outline)
    return float(project_onto_track_vectorized(x, y, seg_vecs, seg_lens, cum_lens))


def _times_to_ms(times) -> np.ndarray:
    """Convert a telemetry ``Time`` column to a float64 array of milliseconds.

    FastF1 stores telemetry times as ``timedelta64[ns]``. Older callers passed
    plain numeric millisecond values, so accept those unchanged.
    """
    values = times.values if hasattr(times, 'values') else np.asarray(times)
    if np.issubdtype(np.asarray(values).dtype, np.timedelta64):
        return np.asarray(values, dtype='timedelta64[ns]') / np.timedelta64(1, 'ms')
    return np.asarray(values, dtype=np.float64)


def _driver_telemetry(telemetry, driver_num):
    """Return a copy of one driver's telemetry.

    FastF1 >= 3 keys ``pos_data``/``car_data`` by driver number; older releases
    returned a single concatenated DataFrame with a ``DriverNumber`` column.
    Support both so the ETL is not tied to one FastF1 version.
    """
    if telemetry is None:
        return pd.DataFrame()
    if isinstance(telemetry, dict):
        for key in (driver_num, str(driver_num)):
            frame = telemetry.get(key)
            if frame is not None:
                return frame.copy()
        try:
            frame = telemetry.get(int(driver_num))
        except (TypeError, ValueError):
            frame = None
        return frame.copy() if frame is not None else pd.DataFrame()
    if 'DriverNumber' not in telemetry.columns:
        return pd.DataFrame()
    return telemetry[telemetry['DriverNumber'] == driver_num].copy()


def _time_value_to_ms(value) -> float | None:
    """Convert one FastF1 lap timestamp to float milliseconds (session clock)."""
    if value is None or pd.isna(value):
        return None
    if hasattr(value, 'total_seconds'):
        return float(value.total_seconds() * 1000.0)
    if hasattr(value, 'value'):  # pandas Timestamp -> nanoseconds since epoch
        return float(value.value / 1_000_000)
    return float(value)


def _driver_lap_windows(session, driver_code: str, lights_out_ms: int):
    """Lights-out-relative (start_ms, end_ms) windows for each of a driver's laps.

    Progress derived from timing (which lap a sample falls in, and how far
    through it) is stable and resets every lap, unlike a nearest-point
    projection onto a coarse corner polyline.
    """
    try:
        rows = session.laps[session.laps['Driver'] == driver_code]
    except Exception:
        return None
    if rows is None or len(rows) == 0:
        return None

    windows = []
    for _, lap in rows.sort_values('LapNumber').iterrows():
        end_ms = _time_value_to_ms(lap.get('Time'))
        if end_ms is None:
            continue
        end_ms -= lights_out_ms
        start_ms = _time_value_to_ms(lap.get('LapStartTime'))
        start_ms = (windows[-1][1] if windows else 0.0) if start_ms is None else start_ms - lights_out_ms
        if end_ms <= start_ms:
            continue
        windows.append((max(0.0, start_ms), max(0.0, end_ms)))

    return windows or None


def _progress_from_lap_windows(times_ms: np.ndarray, windows) -> np.ndarray:
    """Within-lap progress (0..100) for each sample time, using lap timing.

    A sample before the first lap start reads 0; a sample past the final lap
    end reads 100; otherwise it is the fraction elapsed through its current lap.
    """
    times = np.asarray(times_ms, dtype=np.float64)
    starts = np.array([w[0] for w in windows], dtype=np.float64)
    ends = np.array([w[1] for w in windows], dtype=np.float64)

    out = np.zeros(times.shape, dtype=np.float32)
    lap_index = np.searchsorted(starts, times, side='right') - 1
    valid = lap_index >= 0
    if np.any(valid):
        clamped = np.clip(lap_index[valid], 0, len(windows) - 1)
        span = np.maximum(ends[clamped] - starts[clamped], 1.0)
        frac = (times[valid] - starts[clamped]) / span * 100.0
        out[valid] = np.clip(frac, 0.0, 100.0).astype(np.float32)
    return out


def generate_motion_data(session, driver_order: list, track_outline: list,
                         duration_ms: int, sample_hz: int = 5) -> dict:
    """Generate motion data for all drivers at 5Hz grid.
    
    Uses real telemetry data from session.pos_data and session.car_data.
    Data is resampled to 5Hz (200ms) grid from lights-out.
    Progress is computed by projecting x,y onto track outline.
    
    Returns data for all chunks combined: flat [driver][step] array
    where steps from all chunks are concatenated.
    """
    # Precompute track arclength for vectorized projection
    seg_vecs, seg_lens, cum_lens, total_track_length = precompute_track_arclength(track_outline)
    
    # Get lights-out offset from session status
    lights_out_ms = _get_lights_out_offset(session)
    
    # Grid parameters
    grid_ms = 1000 / sample_hz  # 200ms per sample
    samples_per_chunk = 60 * sample_hz  # 300 samples per 60s chunk
    num_chunks = int(np.ceil(duration_ms / 60000))
    
    n_drivers = len(driver_order)
    n_steps_per_chunk = samples_per_chunk
    total_steps = n_steps_per_chunk * num_chunks
    
    # Initialize arrays - flat, [driver][step] layout across all chunks
    total_elements = n_drivers * total_steps
    
    progress_data = np.zeros(total_elements, dtype=np.float32)
    x_data = np.zeros(total_elements, dtype=np.float32)
    y_data = np.zeros(total_elements, dtype=np.float32)
    speed_data = np.zeros(total_elements, dtype=np.float32)
    status_data = np.zeros(total_elements, dtype=np.uint8)
    
    # Load telemetry data
    session.load()
    pos_data = session.pos_data
    car_data = session.car_data
    
    # For each driver, process their telemetry
    for drv_idx, driver_code in enumerate(driver_order):
        # Get driver number from code
        driver_num = None
        for _, row in session.results.iterrows():
            if row['Abbreviation'] == driver_code:
                driver_num = row['DriverNumber']
                break
        
        if driver_num is None:
            # Driver not found, skip
            continue
            
        # Filter data for this driver
        driver_pos = _driver_telemetry(pos_data, driver_num)
        driver_car = _driver_telemetry(car_data, driver_num)
        
        if driver_pos.empty and driver_car.empty:
            # No data for driver, skip
            continue

        # Lap windows drive progress (per-lap 0..100). Fall back to geometric
        # projection when a driver has no usable lap timing, but never project
        # a DNS/retired car's garage position onto the track: that produced a
        # constant high progress value and a bogus P1 on the leaderboard.
        lap_windows = _driver_lap_windows(session, driver_code, lights_out_ms)
        driver_out = _driver_is_out(session, driver_code)
            
        # Times are authored on a lights-out-relative timeline (engine time 0 =
        # race start). FastF1 reports telemetry `Time` on the absolute session
        # clock, so subtract lights_out to match the chunk grid and status data.
        t_end = duration_ms
        
        # Create time grid for this chunk range
        for chunk_idx in range(num_chunks):
            chunk_start_ms = chunk_idx * 60000
            chunk_end_ms = min((chunk_idx + 1) * 60000, t_end)
            chunk_base = chunk_idx * n_steps_per_chunk
            
            # Times for this chunk
            chunk_times = np.arange(chunk_start_ms, chunk_end_ms, grid_ms)
            if len(chunk_times) == 0:
                continue
                
            # Ensure we don't exceed samples_per_chunk
            if len(chunk_times) > samples_per_chunk:
                chunk_times = chunk_times[:samples_per_chunk]
            elif len(chunk_times) < samples_per_chunk:
                # Pad with last value or extend? For now, just use what we have
                pass
                
            # Interpolate position and speed data to chunk times
            if not driver_pos.empty:
                # Interpolate X, Y
                pos_times_ms = _times_to_ms(driver_pos['Time']) - lights_out_ms
                
                # Interpolate to chunk times
                if len(pos_times_ms) > 1:
                    x_interp = np.interp(chunk_times, pos_times_ms, driver_pos['X'].values, left=np.nan, right=np.nan)
                    y_interp = np.interp(chunk_times, pos_times_ms, driver_pos['Y'].values, left=np.nan, right=np.nan)
                else:
                    x_interp = np.full(len(chunk_times), np.nan)
                    y_interp = np.full(len(chunk_times), np.nan)
                
                # Progress comes from lap timing: stable, monotonic within each
                # lap, and resets to 0 at the line. The geometric projection is
                # only a fallback for drivers without usable lap timing; a car
                # that never started keeps progress at zero.
                if lap_windows:
                    progress_chunk = _progress_from_lap_windows(chunk_times, lap_windows)
                elif driver_out:
                    progress_chunk = np.zeros(len(chunk_times), dtype=np.float32)
                else:
                    progress_chunk = np.zeros(len(chunk_times), dtype=np.float32)
                    valid_mask = ~(np.isnan(x_interp) | np.isnan(y_interp))
                    if np.any(valid_mask):
                        pv = project_onto_track_vectorized(
                            x_interp[valid_mask], y_interp[valid_mask],
                            seg_vecs, seg_lens, cum_lens,
                        )
                        if total_track_length > 0:
                            pv = (pv / total_track_length) % 1.0 * 100.0
                        progress_chunk[valid_mask] = pv
                
                # Store progress data
                for step in range(min(len(chunk_times), n_steps_per_chunk)):
                    idx = drv_idx * total_steps + chunk_base + step
                    if idx < total_elements:
                        progress_data[idx] = progress_chunk[step]
                        x_data[idx] = x_interp[step]
                        y_data[idx] = y_interp[step]
            else:
                # No position data, use zeros
                pass
                
            # Interpolate speed data
            if not driver_car.empty:
                car_times_ms = _times_to_ms(driver_car['Time']) - lights_out_ms
                
                if len(car_times_ms) > 1:
                    speed_interp = np.interp(chunk_times, car_times_ms, driver_car['Speed'].values, left=np.nan, right=np.nan)
                    # Convert from m/s to km/h if needed (FastF1 car data speed is in km/h)
                    # Actually, let's check - FastF1 Speed is typically in km/h
                    for step in range(min(len(speed_interp), n_steps_per_chunk)):
                        idx = drv_idx * total_steps + chunk_base + step
                        if idx < total_elements and not np.isnan(speed_interp[step]):
                            speed_data[idx] = float(speed_interp[step])
                        elif idx < total_elements:
                            speed_data[idx] = 0.0  # Default if no data
            else:
                # No car data, use default speed
                for step in range(n_steps_per_chunk):
                    idx = drv_idx * total_steps + chunk_base + step
                    if idx < total_elements:
                        speed_data[idx] = 0.0
            
            # Determine status for this chunk based on actual session data
            # Status: 0 = running, 1 = pit, 2 = out (retired/DNF)
            # We'll determine this from lap data and session status
            status_chunk = _determine_driver_status(session, driver_code, chunk_start_ms, chunk_end_ms, driver_order, drv_idx)
            
            for step in range(min(len(status_chunk), n_steps_per_chunk)):
                idx = drv_idx * total_steps + chunk_base + step
                if idx < total_elements:
                    status_data[idx] = status_chunk[step]
    
    # Progress is a within-lap fraction (0..100) so it resets at the line; it is
    # intentionally not forced to be globally non-decreasing.
    
    return {
        'progress': progress_data,
        'x': x_data,
        'y': y_data,
        'speed': speed_data,
        'status': status_data,
        'sampleHz': sample_hz,
        'chunkSeconds': 60,
        'numChunks': num_chunks,
        'driverCount': n_drivers,
    }


# The lights-out offset is stable for a loaded session. Cache it so the status
# loop does not trigger a full session reload on every chunk.
_LIGHTS_OUT_CACHE = {}


def _get_lights_out_offset(session) -> int:
    """Get lights-out time offset from session start in milliseconds."""
    key = id(session)
    if key in _LIGHTS_OUT_CACHE:
        return _LIGHTS_OUT_CACHE[key]

    offset = 0
    try:
        session.load()

        # FastF1 >= 3 exposes `session_status`; older releases used `status`.
        status_data = getattr(session, 'session_status', None)
        if status_data is None:
            status_data = getattr(session, 'status', None)

        if status_data is not None and not status_data.empty:
            started_row = status_data[status_data['Status'] == 'Started']
            if not started_row.empty:
                started_time = started_row.iloc[0]['Time']
                if hasattr(started_time, 'total_seconds'):
                    offset = int(started_time.total_seconds() * 1000)
                else:
                    offset = int(pd.Timedelta(started_time).total_seconds() * 1000)
    except Exception:
        offset = 0

    _LIGHTS_OUT_CACHE[key] = offset
    return offset


# Result statuses that mean the car is no longer taking part. "Did Not Start"
# is emitted by the OpenF1 adapter for DNS entries; the others cover FastF1's
# retirement reasons.
_OUT_STATUSES = {
    'Retired',
    'Accident',
    'Collision',
    'Mechanical',
    'Severe Damage',
    'Did Not Start',
    'DNS',
    'Withdrawn',
    'Disqualified',
    'DSQ',
}


def _driver_result(session, driver_code: str):
    """Return the final result row for a driver, or ``None`` when unavailable."""
    try:
        results = getattr(session, 'results', None)
        if results is None or results.empty:
            return None
        rows = results[results['Abbreviation'] == driver_code]
        if rows.empty:
            return None
        return rows.iloc[0]
    except Exception:
        return None


def _driver_is_out(session, driver_code: str) -> bool:
    """True when the final classification says the driver never started/retired."""
    result = _driver_result(session, driver_code)
    if result is None:
        return False

    status = str(result.get('Status', '') or '')
    if status in _OUT_STATUSES:
        return True

    laps = result.get('Laps')
    try:
        if pd.notna(laps) and int(laps) == 0:
            return True
    except (TypeError, ValueError):
        pass
    return False


def _determine_driver_status(session, driver_code: str, chunk_start_ms: int, chunk_end_ms: int,
                             driver_order: list, drv_idx: int) -> np.ndarray:
    """Determine driver status for a time chunk.
    
    Returns array of status values (0=running, 1=pit, 2=out) for each step in chunk.
    """
    # Get number of steps in this chunk
    grid_ms = 200  # 5Hz
    steps_in_chunk = int(60000 / grid_ms)  # 300 steps per 60s chunk
    
    # Initialize all as running (0)
    status_chunk = np.zeros(steps_in_chunk, dtype=np.uint8)
    
    # Get driver's laps
    driver_laps = session.laps[session.laps['Driver'] == driver_code].copy()

    result = _driver_result(session, driver_code)
    status = str(result.get('Status', '') or '') if result is not None else ''
    result_laps = result.get('Laps') if result is not None else None
    no_laps = False
    try:
        no_laps = pd.notna(result_laps) and int(result_laps) == 0
    except (TypeError, ValueError):
        no_laps = False

    # A DNS (or a car eliminated before completing a lap) is outside the
    # running order for the entire session. Without this the garage location
    # was projected onto the track and could hold a high, constant progress.
    if status in _OUT_STATUSES and (status in ('Did Not Start', 'DNS') or no_laps):
        status_chunk.fill(2)
        return status_chunk

    if driver_laps.empty:
        if _driver_is_out(session, driver_code):
            status_chunk.fill(2)
        return status_chunk
    
    # Sort by lap number
    driver_laps = driver_laps.sort_values('LapNumber')
    
    # Get lights-out offset
    lights_out_ms = _get_lights_out_offset(session)
    
    # Mark pit stops
    for _, lap in driver_laps.iterrows():
        pit_in_time = lap.get('PitInTime')
        pit_out_time = lap.get('PitOutTime')
        
        if pd.notna(pit_in_time) and pd.notna(pit_out_time):
            # Convert to milliseconds and offset to lights-out
            if hasattr(pit_in_time, 'total_seconds'):
                pit_in_ms = int(pit_in_time.total_seconds() * 1000) - lights_out_ms
                pit_out_ms = int(pit_out_time.total_seconds() * 1000) - lights_out_ms
            else:
                pit_in_ms = int(pit_in_time) - lights_out_ms
                pit_out_ms = int(pit_out_time) - lights_out_ms
            
            # Ensure non-negative
            pit_in_ms = max(0, pit_in_ms)
            pit_out_ms = max(0, pit_out_ms)
            
            # Check if this pit stop overlaps with our chunk
            if pit_out_ms > chunk_start_ms and pit_in_ms < chunk_end_ms:
                # Pit stop overlaps with chunk - mark overlapping steps as pit (1)
                overlap_start = max(pit_in_ms, chunk_start_ms)
                overlap_end = min(pit_out_ms, chunk_end_ms)
                
                # Convert to step indices within chunk
                start_step = int((overlap_start - chunk_start_ms) / grid_ms)
                end_step = int((overlap_end - chunk_start_ms) / grid_ms)
                
                # Clamp to valid range
                start_step = max(0, min(start_step, steps_in_chunk))
                end_step = max(0, min(end_step, steps_in_chunk))
                
                # Mark pit steps
                if start_step < end_step:  # Ensure we have a valid range
                    status_chunk[start_step:end_step] = 1
    
    # Check for retirement (if driver stops completing laps)
    # A simple heuristic: if driver's last lap is significantly before the end of session,
    # and they have no pit out after that, they might be retired
    # Better approach: check session.results for status
    try:
        if result is not None and status in _OUT_STATUSES:
            # Find retirement time - approximate as end of last completed lap
            if not driver_laps.empty:
                last_lap = driver_laps.iloc[-1]
                last_lap_end = last_lap.get('Time')
                if pd.notna(last_lap_end):
                    if hasattr(last_lap_end, 'total_seconds'):
                        retirement_ms = int(last_lap_end.total_seconds() * 1000) - lights_out_ms
                    else:
                        retirement_ms = int(last_lap_end) - lights_out_ms
                    retirement_ms = max(0, retirement_ms)
                    
                    # If retirement time is within or after our chunk, mark as out (2)
                    if retirement_ms <= chunk_end_ms:
                        # Mark from retirement time onwards as out
                        if retirement_ms >= chunk_start_ms:
                            # Retirement happens during this chunk
                            retirement_step = int((retirement_ms - chunk_start_ms) / grid_ms)
                            retirement_step = max(0, min(retirement_step, steps_in_chunk))
                            status_chunk[retirement_step:] = 2
                        else:
                            # Retirement happened before this chunk, mark all as out
                            status_chunk.fill(2)
    except Exception:
        # If anything goes wrong with retirement detection, continue with what we have
        pass
    
    return status_chunk


