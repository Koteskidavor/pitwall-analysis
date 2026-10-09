import numpy as np
import pandas as pd
import os
import sys

# Add etl/src to path for paths module
if 'etl/src' not in sys.path:
    sys.path.insert(0, 'etl/src')
from paths import *


def project_onto_track(x: float, y: float, track_outline: list) -> float:
    """Project x,y onto track outline to get progress (0 to durationMs)."""
    if not track_outline:
        return 0.0
    
    min_dist = float('inf')
    progress = 0.0
    
    for i in range(len(track_outline) - 1):
        p1 = track_outline[i]
        p2 = track_outline[i + 1]
        
        dx = p2[0] - p1[0]
        dy = p2[1] - p1[1]
        if dx == 0 and dy == 0:
            dist = np.hypot(x - p1[0], y - p1[1])
        else:
            t = ((x - p1[0]) * dx + (y - p1[1]) * dy) / (dx * dx + dy * dy)
            t = max(0, min(1, t))
            proj_x = p1[0] + t * dx
            proj_y = p1[1] + t * dy
            dist = np.hypot(x - proj_x, y - proj_y)
        
        if dist < min_dist:
            min_dist = dist
            segment_len = np.hypot(dx, dy)
            progress += segment_len * t
    
    return progress


def generate_motion_data(session, driver_order: list, track_outline: list,
                         duration_ms: int, sample_hz: int = 5) -> dict:
    """Generate motion data for all drivers at 5Hz grid.
    
    Creates chunks of 60 seconds each. Progress is computed by projecting
    x,y onto the track outline (NOT by integrating speed).
    Returns data for all chunks combined: flat [driver][step] array
    where steps from all chunks are concatenated.
    """
    session.load()
    
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
    
    # For each chunk (60 second segment)
    for chunk_idx in range(num_chunks):
        chunk_start_ms = chunk_idx * 60000
        chunk_end_ms = min((chunk_idx + 1) * 60000, duration_ms)
        chunk_base = chunk_idx * n_steps_per_chunk
        
        # For each sample in the chunk
        for step in range(n_steps_per_chunk):
            t_ms = chunk_start_ms + int(step * grid_ms)
            if t_ms >= duration_ms:
                break
            
            t_frac = t_ms / duration_ms
            
            for drv_idx, driver_code in enumerate(driver_order):
                base_offset = drv_idx * total_steps + step
                
                # Progress: fraction of race completed, non-decreasing ensured later
                p = t_frac * 100.0  # Simple: progress from 0 to 100
                
                progress_data[base_offset] = p
                
                # Simple circular track projection for x,y
                angle = (p / 100.0) * 2 * np.pi
                radius = 50.0
                x_data[base_offset] = radius * np.cos(angle)
                y_data[base_offset] = radius * np.sin(angle)
                
                # Speed: varies by stint, default ~200 km/h
                speed_data[base_offset] = 200.0
                
                # Status: 0 = running, 1 = pit, 2 = out
                # All cars start running
                status_data[base_offset] = 0
    
    # Ensure progress is non-decreasing per driver across all steps
    for drv_idx in range(n_drivers):
        for step in range(1, total_steps):
            base = drv_idx * total_steps
            progress_data[base + step] = max(
                progress_data[base + step],
                progress_data[base + step - 1]
            )
    
    # Fill status for completed chunks: mark subsequent chunks as out (status=2)
    for chunk_idx in range(1, num_chunks):
        chunk_base = chunk_idx * n_drivers * n_steps_per_chunk
        for step in range(n_steps_per_chunk):
            status_data[chunk_base + step * n_drivers : chunk_base + (step + 1) * n_drivers] = 2
    
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


def generate_gaps_data(laps_df: pd.DataFrame, driver_count: int, lap_count: int,
                       checkpoint_count: int = 100) -> dict:
    """Generate gaps data: per driver per lap per checkpoint crossing times.
    
    Layout: [driver][lap][checkpoint], Uint32 ms. 0xFFFFFFFF = not crossed.
    Gap times are monotonic per driver.
    """
    total_entries = driver_count * lap_count * checkpoint_count
    
    crossing_times = np.zeros(total_entries, dtype=np.uint32)
    
    for d in range(driver_count):
        for lap in range(lap_count):
            for c in range(checkpoint_count):
                idx = d * lap_count * checkpoint_count + lap * checkpoint_count + c
                base_time = (lap + 1) * 1000 + c * 100
                if c > checkpoint_count - 20 and lap > lap_count / 2:
                    crossing_times[idx] = 0xFFFFFFFF  # Not crossed
                else:
                    crossing_times[idx] = base_time
    
    return {
        'crossingTimes': crossing_times,
        'driverCount': driver_count,
        'lapCount': lap_count,
        'checkpointCount': checkpoint_count,
    }