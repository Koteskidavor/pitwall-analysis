import numpy as np
import pandas as pd
import os
import sys

# Add etl/src to path for paths module
if 'etl/src' not in sys.path:
    sys.path.insert(0, 'etl/src')
from paths import *


def generate_gaps_data(laps_df: pd.DataFrame, driver_count: int, lap_count: int,
                       checkpoint_count: int = 100) -> dict:
    """Generate gaps data: per driver per lap per checkpoint crossing times.
    
    Uses actual lap times from laps_df to compute realistic checkpoint crossing times.
    
    Layout: [driver][lap][checkpoint], Uint32 ms. 0xFFFFFFFF = not crossed.
    Gap times are monotonic per driver per lap.
    """
    total_entries = driver_count * lap_count * checkpoint_count
    
    crossing_times = np.full(total_entries, 0xFFFFFFFF, dtype=np.uint32)  # Default: not crossed
    
    # Create mapping from driver code to index
    # We'll assume driver_order is the same as in laps_df, or we need to map
    # For now, let's get unique drivers from laps_df
    if not laps_df.empty and 'Driver' in laps_df.columns:
        unique_drivers = laps_df['Driver'].unique()
        driver_to_idx = {driver: idx for idx, driver in enumerate(unique_drivers)}
    else:
        # Fallback to sequential indexing
        driver_to_idx = {}
    
    # Process each lap
    for _, lap in laps_df.iterrows():
        driver_code = lap.get('Driver', '')
        lap_num = int(lap.get('LapNumber', 0))
        lap_time_ms = lap.get('Time')
        
        # Skip if lap number is out of range or no lap time
        if lap_num < 1 or lap_num > lap_count or pd.isna(lap_time_ms):
            continue
            
        # Convert lap time to milliseconds
        if hasattr(lap_time_ms, 'total_seconds'):
            lap_time_ms = int(lap_time_ms.total_seconds() * 1000)
        else:
            lap_time_ms = int(lap_time_ms)
        
        # Get driver index
        if driver_code in driver_to_idx:
            d_idx = driver_to_idx[driver_code]
        else:
            # Assign sequential index if not in map (shouldn't happen in normal flow)
            d_idx = len(driver_to_idx)
            driver_to_idx[driver_code] = d_idx
        
        # Skip if driver index is out of range
        if d_idx >= driver_count:
            continue
            
        # Lap index (0-based)
        lap_idx = lap_num - 1
        
        # Generate checkpoint times for this lap
        # Use actual lap time and create realistic progression
        # We'll use a combination of linear progression with some variation
        # based on sector times if available
        
        # Get sector times if available
        s1_time = lap.get('S1Time')
        s2_time = lap.get('S2Time')
        s3_time = lap.get('S3Time')
        
        sector_times = []
        if not pd.isna(s1_time):
            sector_times.append(s1_time.total_seconds() * 1000 if hasattr(s1_time, 'total_seconds') else s1_time)
        if not pd.isna(s2_time):
            sector_times.append(s2_time.total_seconds() * 1000 if hasattr(s2_time, 'total_seconds') else s2_time)
        if not pd.isna(s3_time):
            sector_times.append(s3_time.total_seconds() * 1000 if hasattr(s3_time, 'total_seconds') else s3_time)
        
        # If we have sector times that sum to approximately lap time, use them
        # Otherwise, fall back to linear distribution with slight randomization
        use_sectors = len(sector_times) == 3 and abs(sum(sector_times) - lap_time_ms) < lap_time_ms * 0.1
        
        for c in range(checkpoint_count):
            idx = d_idx * lap_count * checkpoint_count + lap_idx * checkpoint_count + c
            
            if use_sectors:
                # Distribute checkpoints based on sector progression
                sector_boundaries = [0, sector_times[0], sector_times[0] + sector_times[1], lap_time_ms]
                # Find which sector this checkpoint falls in
                sector_progress = c / (checkpoint_count - 1) if checkpoint_count > 1 else 0
                target_time = sector_progress * lap_time_ms
                
                # Map to sector-relative time
                if sector_progress <= sector_boundaries[1] / lap_time_ms:
                    # Sector 1
                    sect_progress = sector_progress * lap_time_ms / sector_boundaries[1] if sector_boundaries[1] > 0 else 0
                    checkpoint_time = sect_progress * sector_times[0]
                elif sector_progress <= sector_boundaries[2] / lap_time_ms:
                    # Sector 2
                    sect_progress = (sector_progress * lap_time_ms - sector_boundaries[1]) / (sector_boundaries[2] - sector_boundaries[1]) if sector_boundaries[2] > sector_boundaries[1] else 0
                    checkpoint_time = sector_times[0] + sect_progress * sector_times[1]
                else:
                    # Sector 3
                    sect_progress = (sector_progress * lap_time_ms - sector_boundaries[2]) / (lap_time_ms - sector_boundaries[2]) if lap_time_ms > sector_boundaries[2] else 0
                    checkpoint_time = sector_times[0] + sector_times[1] + sect_progress * sector_times[2]
            else:
                # Linear distribution with slight realistic variation
                base_time = (c / (checkpoint_count - 1)) * lap_time_ms if checkpoint_count > 1 else 0
                # Add small random variation to avoid too-perfect linearity (±2%)
                variation = np.random.uniform(-0.02, 0.02) * lap_time_ms
                checkpoint_time = base_time + variation
                # Ensure monotonic (each checkpoint should be >= previous)
                if c > 0:
                    prev_idx = d_idx * lap_count * checkpoint_count + lap_idx * checkpoint_count + (c - 1)
                    prev_time = crossing_times[prev_idx]
                    if prev_time != 0xFFFFFFFF and checkpoint_time < prev_time:
                        checkpoint_time = prev_time + 1  # Ensure at least 1ms advancement
            
            # Store as Uint32, ensuring it's in valid range
            if 0 <= checkpoint_time < 0xFFFFFFFF:
                crossing_times[idx] = int(checkpoint_time)
            # Else leave as 0xFFFFFFFF (not crossed)
    
    # Ensure monotonicity per driver per lap (forward pass)
    for d in range(min(driver_count, len(driver_to_idx))):
        for lap in range(lap_count):
            last_time = 0
            for c in range(checkpoint_count):
                idx = d * lap_count * checkpoint_count + lap * checkpoint_count + c
                if crossing_times[idx] != 0xFFFFFFFF:
                    if crossing_times[idx] < last_time:
                        # Make it monotonic by setting to last_time + 1
                        crossing_times[idx] = last_time + 1
                    last_time = crossing_times[idx]
    
    return {
        'crossingTimes': crossing_times,
        'driverCount': driver_count,
        'lapCount': lap_count,
        'checkpointCount': checkpoint_count,
    }