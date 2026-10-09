import pandas as pd
from paths import *

def calculate_strategy(laps_df: pd.DataFrame, stints_df: pd.DataFrame) -> pd.DataFrame:
    """Calculate tyre strategy from laps and stints."""
    if laps_df.empty or stints_df.empty:
        return pd.DataFrame()
    
    # Group laps by driver and stint
    strategy = laps_df.groupby('driverId').agg(
        total_laps=('time_ms', 'count'),
        total_time_ms=('time_ms', 'sum'),
    ).reset_index()
    
    # Merge with stint info
    if not strategy.empty and not stints_df.empty:
        strategy = strategy.merge(stints_df, on='driverId', how='left')
    
    return strategy

def compute_pit_loss(laps_df: pd.DataFrame, pit_stops_df: pd.DataFrame) -> pd.DataFrame:
    """Compute pit lane time loss per driver."""
    if laps_df.empty or pit_stops_df.empty:
        return pd.DataFrame()
    
    # Find laps immediately before pit stops
    result = []
    for driver_id in pit_stops_df['driverId'].unique():
        driver_laps = laps_df[laps_df['driverId'] == driver_id]
        driver_pits = pit_stops_df[pit_stops_df['driverId'] == driver_id]
        
        if len(driver_laps) > 0 and len(driver_pits) > 0:
            # Get the lap just before each pit stop
            for _, pit in driver_pits.iterrows():
                pit_lap = pit['lap']
                # Find the best lap time around the pit stop
                before_pit = driver_laps[driver_laps['position'] > 0]
                if len(before_pit) > 0:
                    result.append({
                        'driverId': driver_id,
                        'pit_lap': pit_lap,
                        'pit_lane_time_ms': pit.get('duration_ms', 0),
                    })
    
    return pd.DataFrame(result)