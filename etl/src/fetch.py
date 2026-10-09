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
    """Fetch a FastF1 session object."""
    valid_sessions = ['Race', 'Qualifying', 'Sprint']
    if session_name not in valid_sessions:
        raise ValueError(f"Invalid session name: {session_name}. Valid sessions are: {valid_sessions}")
    
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
            timestamp = msg.get('Time')
            if pd.notna(timestamp):
                # Convert timestamp to milliseconds since epoch
                if hasattr(timestamp, 'total_seconds'):
                    # pandas Timestamp or similar
                    timestamp_ms = int(timestamp.total_seconds() * 1000)
                else:
                    # Try to convert to int directly (for UNIX timestamps)
                    timestamp_ms = int(timestamp) * 1000
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
            timestamp = status.get('Time')
            if pd.notna(timestamp):
                if hasattr(timestamp, 'total_seconds'):
                    timestamp_ms = int(timestamp.total_seconds() * 1000) - lights_out_ms
                else:
                    timestamp_ms = int(timestamp) - lights_out_ms
                timestamp_ms = max(0, timestamp_ms)
                
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
            timestamp = status.get('Time')
            if pd.notna(timestamp):
                if hasattr(timestamp, 'total_seconds'):
                    timestamp_ms = int(timestamp.total_seconds() * 1000) - lights_out_ms
                else:
                    timestamp_ms = int(timestamp) - lights_out_ms
                timestamp_ms = max(0, timestamp_ms)
                
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