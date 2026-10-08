import fastf1
import pandas as pd
from .paths import race_dir, manifest_path, track_path

def fetch_session(year: int, round: int, session_name: str):
    """Fetch a FastF1 session object."""
    valid_sessions = ['Race', 'Qualifying', 'Sprint']
    if session_name not in valid_sessions:
        session_name = 'Race'
    
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
    """Get event data from session."""
    session.load()
    return session.events