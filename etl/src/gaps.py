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

    Layout: [driver][lap][checkpoint], Uint32 ms. 0xFFFFFFFF = not crossed.
    Gap times are monotonic per driver per lap.
    """
    total_entries = driver_count * lap_count * checkpoint_count

    crossing_times = np.zeros(total_entries, dtype=np.uint32)

    # Fill with simulated data
    for d in range(driver_count):
        for lap in range(lap_count):
            for c in range(checkpoint_count):
                idx = d * lap_count * checkpoint_count + lap * checkpoint_count + c
                # Simulate crossing time - increase per lap, some not crossed
                base_time = (lap + 1) * 1000 + c * 100
                # Some checkpoints not crossed (especially later laps)
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