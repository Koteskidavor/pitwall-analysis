import numpy as np
import pandas as pd
import os
import sys

# Add etl/src to path for paths module
if 'etl/src' not in sys.path:
    sys.path.insert(0, 'etl/src')
from paths import *


def precompute_track_arclength(track_outline: list) -> tuple:
    """Precompute cumulative arclength along track outline.
    
    Returns (segment_vectors, segment_lengths, cumulative_lengths, total_length)
    """
    if not track_outline or len(track_outline) < 2:
        return np.array([]), np.array([]), np.array([0.0]), 0.0
    
    pts = np.array(track_outline, dtype=np.float32)
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
                driver_num = int(row['DriverNumber'])
                break
        
        if driver_num is None:
            # Driver not found, skip
            continue
            
        # Filter data for this driver
        driver_pos = pos_data[pos_data['DriverNumber'] == driver_num].copy() if not pos_data.empty else pd.DataFrame()
        driver_car = car_data[car_data['DriverNumber'] == driver_num].copy() if not car_data.empty else pd.DataFrame()
        
        if driver_pos.empty and driver_car.empty:
            # No data for driver, skip
            continue
            
        # Time array for samples (relative to lights-out)
        t_start = lights_out_ms
        t_end = lights_out_ms + duration_ms
        
        # Create time grid for this chunk range
        for chunk_idx in range(num_chunks):
            chunk_start_ms = lights_out_ms + chunk_idx * 60000
            chunk_end_ms = min(lights_out_ms + (chunk_idx + 1) * 60000, t_end)
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
                pos_times = driver_pos['Time'].values
                # Convert to milliseconds if needed
                if hasattr(pos_times[0], 'total_seconds'):
                    pos_times_ms = np.array([t.total_seconds() * 1000 for t in pos_times])
                else:
                    pos_times_ms = pos_times
                
                # Add lights-out offset if not already applied
                pos_times_ms += lights_out_ms
                
                # Interpolate to chunk times
                if len(pos_times_ms) > 1:
                    x_interp = np.interp(chunk_times, pos_times_ms, driver_pos['X'].values, left=np.nan, right=np.nan)
                    y_interp = np.interp(chunk_times, pos_times_ms, driver_pos['Y'].values, left=np.nan, right=np.nan)
                    
                    # Project to track progress
                    if len(x_interp) > 0 and not np.all(np.isnan(x_interp)):
                        # Remove NaNs for projection
                        valid_mask = ~(np.isnan(x_interp) | np.isnan(y_interp))
                        if np.any(valid_mask):
                            x_valid = x_interp[valid_mask]
                            y_valid = y_interp[valid_mask]
                            times_valid = chunk_times[valid_mask]
                            
                            progress_valid = project_onto_track_vectorized(x_valid, y_valid, seg_vecs, seg_lens, cum_lens)
                            
                            # Map back to full array
                            progress_chunk = np.full(len(chunk_times), np.nan)
                            progress_chunk[valid_mask] = progress_valid
                            
                            # Fill NaNs with nearest valid values
                            for i in range(len(progress_chunk)):
                                if np.isnan(progress_chunk[i]):
                                    # Find nearest non-NaN
                                    left_idx = np.where(~np.isnan(progress_chunk[:i]))[0]
                                    right_idx = np.where(~np.isnan(progress_chunk[i:]))[0]
                                    if len(left_idx) > 0 and len(right_idx) > 0:
                                        progress_chunk[i] = progress_chunk[left_idx[-1]]
                                    elif len(left_idx) > 0:
                                        progress_chunk[i] = progress_chunk[left_idx[-1]]
                                    elif len(right_idx) > 0:
                                        progress_chunk[i] = progress_chunk[right_idx[0] + i]
                                    else:
                                        progress_chunk[i] = 0.0
                        else:
                            progress_chunk = np.zeros(len(chunk_times))
                    else:
                        progress_chunk = np.zeros(len(chunk_times))
                    
                    # Store progress data
                    for step, t_offset in enumerate(range(len(chunk_times))):
                        if step < n_steps_per_chunk:
                            idx = drv_idx * total_steps + chunk_base * n_steps_per_chunk + step
                            if idx < total_elements:
                                progress_data[idx] = progress_chunk[step]
                                x_data[idx] = x_interp[step] if step < len(x_interp) else 0.0
                                y_data[idx] = y_interp[step] if step < len(y_interp) else 0.0
            else:
                # No position data, use zeros
                pass
                
            # Interpolate speed data
            if not driver_car.empty:
                car_times = driver_car['Time'].values
                if hasattr(car_times[0], 'total_seconds'):
                    car_times_ms = np.array([t.total_seconds() * 1000 for t in car_times])
                else:
                    car_times_ms = car_times
                
                # Add lights-out offset if not already applied
                car_times_ms += lights_out_ms
                
                if len(car_times_ms) > 1:
                    speed_interp = np.interp(chunk_times, car_times_ms, driver_car['Speed'].values, left=np.nan, right=np.nan)
                    # Convert from m/s to km/h if needed (FastF1 car data speed is in km/h)
                    # Actually, let's check - FastF1 Speed is typically in km/h
                    for step in range(min(len(speed_interp), n_steps_per_chunk)):
                        idx = drv_idx * total_steps + chunk_base * n_steps_per_chunk + step
                        if idx < total_elements and not np.isnan(speed_interp[step]):
                            speed_data[idx] = float(speed_interp[step])
                        elif idx < total_elements:
                            speed_data[idx] = 0.0  # Default if no data
            else:
                # No car data, use default speed
                for step in range(n_steps_per_chunk):
                    idx = drv_idx * total_steps + chunk_base * n_steps_per_chunk + step
                    if idx < total_elements:
                        speed_data[idx] = 0.0
            
            # Determine status for this chunk based on actual session data
            # Status: 0 = running, 1 = pit, 2 = out (retired/DNF)
            # We'll determine this from lap data and session status
            status_chunk = _determine_driver_status(session, driver_code, chunk_start_ms, chunk_end_ms, driver_order, drv_idx)
            
            for step in range(min(len(status_chunk), n_steps_per_chunk)):
                idx = drv_idx * total_steps + chunk_base * n_steps_per_chunk + step
                if idx < total_elements:
                    status_data[idx] = status_chunk[step]
    
    # Ensure progress is non-decreasing per driver across all steps
    for drv_idx in range(n_drivers):
        for step in range(1, total_steps):
            base = drv_idx * total_steps
            if progress_data[base + step] < progress_data[base + step - 1]:
                progress_data[base + step] = progress_data[base + step - 1]
    
    # Mark status for completed chunks based on actual retirement (simplified)
    # In a real implementation, we'd use actual retirement times from session data
    
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


def _get_lights_out_offset(session) -> int:
    """Get lights-out time offset from session start in milliseconds."""
    try:
        # Load session status if not already loaded
        if not hasattr(session, 'status') or session.status is None:
            session.load()
        
        # Find the "Started" row in session_status
        if hasattr(session, 'status') and session.status is not None:
            status_data = session.status
            # Look for session start time
            started_row = status_data[status_data['Status'] == 'Started']
            if not started_row.empty:
                started_time = started_row.iloc[0]['Time']
                # Convert to milliseconds
                if hasattr(started_time, 'total_seconds'):
                    return int(started_time.total_seconds() * 1000)
                else:
                    # Assume it's already a timedelta or similar
                    return int(pd.Timedelta(started_time).total_seconds() * 1000)
        
        # Fallback: use session start time
        if hasattr(session, 'date'):
            session_start = session.date
            # Lights out is typically at session start for races
            # For qualifying, it's more complex, but we'll use session start
            return 0  # Relative to session start
            
    except Exception:
        pass
    
    # Default: no offset (session time starts at t=0)
    return 0


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
    if driver_laps.empty:
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
        if hasattr(session, 'results') and not session.results.empty:
            driver_result = session.results[session.results['Abbreviation'] == driver_code]
            if not driver_result.empty:
                status = driver_result.iloc[0].get('Status', '')
                if status in ['Retired', 'Accident', 'Collision', 'Mechanical', 'Severe Damage']:
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


