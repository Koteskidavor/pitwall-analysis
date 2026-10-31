import numpy as np
import pandas as pd
import sys

# Add etl/src to path for paths module
if 'etl/src' not in sys.path:
    sys.path.insert(0, 'etl/src')
from paths import *  # noqa: F401,F403

NOT_CROSSED = 0xFFFFFFFF
MAX_CROSSING_MS = NOT_CROSSED - 1


def _to_ms(value) -> float | None:
    """Convert a lap/sector timing value to float milliseconds, or ``None``."""
    if value is None or pd.isna(value):
        return None
    if hasattr(value, 'total_seconds'):
        return float(value.total_seconds()) * 1000.0
    return float(value)


def _lap_duration_ms(lap) -> float | None:
    """Return the duration of one lap in milliseconds.

    ``Time`` is the cumulative race clock on the OpenF1 adapter, not the lap
    duration, so it may only be used together with ``LapStartTime``. Prefer
    ``LapTime`` whenever the source provides it.
    """
    duration = _to_ms(lap.get('LapTime'))
    if duration is not None and duration > 0:
        return duration

    start = _to_ms(lap.get('LapStartTime'))
    end = _to_ms(lap.get('Time'))
    if start is not None and end is not None and end > start:
        return end - start
    return None


def _checkpoint_offsets(lap, lap_time_ms: float, checkpoint_count: int) -> np.ndarray:
    """Crossing offsets (ms from lap start) for every checkpoint.

    Checkpoints are evenly spaced along the lap. When all three sector
    durations are available they shape the distance-to-time mapping; otherwise
    the lap is treated as uniform. Deterministic by construction: no sampling.
    """
    if checkpoint_count <= 1:
        return np.zeros(max(checkpoint_count, 0), dtype=np.float64)

    fractions = np.linspace(0.0, 1.0, checkpoint_count)

    sectors = [_to_ms(lap.get(f'S{index}Time')) for index in (1, 2, 3)]
    if all(sector is not None and sector > 0 for sector in sectors):
        sector_total = float(sum(sectors))
        # Only trust sector timings that actually describe this lap.
        if abs(sector_total - lap_time_ms) <= max(1000.0, lap_time_ms * 0.1):
            cumulative = np.cumsum([0.0, *sectors])
            boundaries = cumulative / sector_total
            offsets = np.interp(fractions, boundaries, cumulative)
            return offsets * (lap_time_ms / sector_total)

    return fractions * lap_time_ms


def generate_gaps_data(laps_df: pd.DataFrame, driver_order, lap_count: int,
                       checkpoint_count: int = 100) -> dict:
    """Generate gaps data: per driver per lap per checkpoint crossing times.

    Layout: ``[driver][lap][checkpoint]``, Uint32 ms, with drivers in
    ``driver_order`` (the same order as ``manifest.driverOrder`` and the motion
    chunks). ``0xFFFFFFFF`` marks a lap/checkpoint that was not completed.
    Crossings are lap-relative and non-decreasing within each lap.

    Crossing times are derived from each lap's duration and sector timings, so
    the output is deterministic and matches the real pace of the lap. They are
    only a fallback: the leaderboard prefers the lap-timing tables.
    """
    driver_order = list(driver_order or [])
    driver_count = len(driver_order)
    lap_count = max(1, int(lap_count or 1))
    checkpoint_count = max(1, int(checkpoint_count))

    total_entries = driver_count * lap_count * checkpoint_count
    crossing_times = np.full(total_entries, NOT_CROSSED, dtype=np.uint32)

    driver_to_idx = {driver: index for index, driver in enumerate(driver_order)}

    if laps_df is not None and not laps_df.empty:
        for _, lap in laps_df.iterrows():
            driver_code = lap.get('Driver')
            lap_num = lap.get('LapNumber')

            d_idx = driver_to_idx.get(driver_code)
            if d_idx is None or lap_num is None or pd.isna(lap_num):
                continue

            lap_num = int(lap_num)
            if lap_num < 1 or lap_num > lap_count:
                continue

            lap_time_ms = _lap_duration_ms(lap)
            if lap_time_ms is None:
                continue

            offsets = _checkpoint_offsets(lap, lap_time_ms, checkpoint_count)
            offsets = np.clip(np.rint(offsets), 0, MAX_CROSSING_MS).astype(np.uint32)

            base = d_idx * lap_count * checkpoint_count + (lap_num - 1) * checkpoint_count
            crossing_times[base:base + checkpoint_count] = offsets

    return {
        'crossingTimes': crossing_times,
        'driverCount': driver_count,
        'lapCount': lap_count,
        'checkpointCount': checkpoint_count,
    }
