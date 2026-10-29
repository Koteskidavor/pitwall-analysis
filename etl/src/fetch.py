import fastf1
import pandas as pd
from paths import race_dir, manifest_path, track_path
# Import paths module - add etl/src to path if needed
import sys
if 'etl/src' not in sys.path:
    sys.path.insert(0, 'etl/src')
from motion import _get_lights_out_offset


def time_to_ms(timedelta_val) -> int:
    """Convert pandas Timedelta to milliseconds.
    
    Returns None for NaT/pd.NaT values, uses rounding instead of truncation.
    """
    if timedelta_val is None or pd.isna(timedelta_val):
        return None  # Return None for NaT as suggested
    if isinstance(timedelta_val, pd.Timedelta):
        return round(timedelta_val.total_seconds() * 1000)  # Use round() not int()
    return round(timedelta_val)  # Use round() for consistency


def fetch_session(year: int, round: int, session_name: str):
    """Fetch a session object.

    FastF1's live-timing archive is no longer publicly available for recent
    seasons, so 2024+ seasons are served from OpenF1 instead. Both sources
    expose the same attributes the rest of the ETL consumes.
    """
    valid_sessions = ['Race', 'Qualifying', 'Sprint']
    if session_name not in valid_sessions:
        raise ValueError(f"Invalid session name: {session_name}. Valid sessions are: {valid_sessions}")

    if year >= 2024:
        from openf1 import OpenF1Session
        return OpenF1Session(year, round, session_name)

    return fastf1.get_session(year, round, session_name)

def get_driver_order(session) -> list:
    """Get driver list from session results."""
    session.load()
    results = session.results
    driver_order = []
    for _, row in results.iterrows():
        driver_code = row['Abbreviation']
        driver_order.append(driver_code)
    return driver_order

def get_lap_data(session, driver_order: list) -> dict:
    """Get lap data for all requested drivers."""
    session.load()
    lap_data = {}
    
    for driver_code in driver_order:
        try:
            driver = session.drivers[0]  # Will be fixed with proper lookup
            driver_laps = session.laps.pick(driver_code)
            if len(driver_laps) > 0:
                lap_data[driver_code] = driver_laps
        except Exception:
            continue
    
    return lap_data

def get_stint_data(session) -> pd.DataFrame:
    """Get stint data from session."""
    session.load()
    return session.stints

def get_pit_stop_data(session) -> pd.DataFrame:
    """Get pit stop data from session."""
    session.load()
    return session.pit_stops

def session_time_to_ms(value, session) -> int | None:
    """Convert a FastF1 event time to milliseconds relative to session start.

    Depending on the data source this is a ``Timedelta`` (already relative),
    an absolute ``Timestamp``, or a plain number. Returning a consistent
    relative value keeps the events aligned with lights-out.
    """
    if value is None or pd.isna(value):
        return None
    if isinstance(value, pd.Timestamp):
        t0 = getattr(session, 't0_date', None) or getattr(session, 'date', None)
        if t0 is not None:
            return int((value - t0).total_seconds() * 1000)
        return int(value.value // 1_000_000)
    if hasattr(value, 'total_seconds'):
        return int(value.total_seconds() * 1000)
    return int(value)


def get_event_data(session) -> list:
    """Get event data from session.
    
    Uses race_control_messages, track_status, and session_status to generate events.
    """
    session.load()
    events = []
    lights_out_ms = _get_lights_out_offset(session)
    
    # Process race control messages
    if hasattr(session, 'race_control_messages') and not session.race_control_messages.empty:
        for _, msg in session.race_control_messages.iterrows():
            # Convert timestamp to milliseconds and offset to lights-out
            timestamp_ms = session_time_to_ms(msg.get('Time'), session)
            if timestamp_ms is not None:
                timestamp_ms = timestamp_ms - lights_out_ms
                timestamp_ms = max(0, timestamp_ms)  # Ensure non-negative
                
                events.append({
                    'id': f"rcm_{len(events)}",
                    'timestamp_ms': timestamp_ms,
                    'type': msg.get('Category', 'unknown'),
                    'driver_id': msg.get('Driver', ''),  # May be empty
                    'message': msg.get('Message', '')
                })
    
    # Process track status changes
    if hasattr(session, 'track_status') and not session.track_status.empty:
        for _, status in session.track_status.iterrows():
            timestamp_ms = session_time_to_ms(status.get('Time'), session)
            if timestamp_ms is not None:
                timestamp_ms = max(0, timestamp_ms - lights_out_ms)
                
                events.append({
                    'id': f"ts_{len(events)}",
                    'timestamp_ms': timestamp_ms,
                    'type': 'track_status',
                    'driver_id': '',  # Track status doesn't have driver
                    'message': f"Track status: {status.get('Status', 'unknown')}"
                })
    
    # Process session status
    if hasattr(session, 'session_status') and not session.session_status.empty:
        for _, status in session.session_status.iterrows():
            timestamp_ms = session_time_to_ms(status.get('Time'), session)
            if timestamp_ms is not None:
                timestamp_ms = max(0, timestamp_ms - lights_out_ms)
                
                events.append({
                    'id': f"ss_{len(events)}",
                    'timestamp_ms': timestamp_ms,
                    'type': status.get('Status', 'unknown'),
                    'driver_id': '',
                    'message': status.get('Message', '')
                })
    
    # Sort events by timestamp
    events.sort(key=lambda x: x['timestamp_ms'])
    
    return events