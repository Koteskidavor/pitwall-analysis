import pandas as pd
import numpy as np
from .paths import *

def clean_laps(laps_df: pd.DataFrame, driver_order: list) -> pd.DataFrame:
    """Clean laps data: filter accurate laps, ensure proper types."""
    if laps_df.empty:
        return laps_df
    
    # Carry FastF1's accuracy flag
    laps_df = laps_df.copy()
    laps_df['is_accurate'] = laps_df['is_accurate']
    
    # Filter to only accurate laps if available, otherwise all
    if 'is_accurate' in laps_df.columns:
        laps_df = laps_df[laps_df['is_accurate'] == True]
    
    # Ensure compound is string
    if 'Compound' in laps_df.columns:
        laps_df['compound'] = laps_df['Compound'].astype(str)
    
    # Select and rename columns to match schema
    laps_df = laps_df.rename(columns={
        'Time': 'time_ms',
        'S1': 's1_ms',
        'S2': 's2_ms',
        'S3': 's3_ms',
        'Position': 'position',
        'Compound': 'compound',
        'TyreAge': 'tyre_age',
    })
    
    # Select only the columns we need
    laps_df = laps_df[[
          'time_ms', 's1_ms', 's2_ms', 's3_ms', 'position', 
          'compound', 'tyre_age', 'is_accurate', 'is_pit_in', 'is_pit_out'
      ]]
    
    return laps_df

def clean_stints(stints_df: pd.DataFrame) -> pd.DataFrame:
    """Clean stints data."""
    if stints_df.empty:
        return stints_df
    
    stints_df = stints_df.copy()
    stints_df = stints_df.rename(columns={
        'Driver': 'driverId',
        'LapStart': 'lapStart',
        'LapEnd': 'lapEnd',
        'Compound': 'compound',
        'TyreAge': 'tyreAgeAtStart',
    })
    
    return stints_df

def clean_pit_stops(pit_stops_df: pd.DataFrame) -> pd.DataFrame:
    """Clean pit stop data."""
    if pit_stops_df.empty:
        return pit_stops_df
    
    pit_stops_df = pit_stops_df.copy()
    pit_stops_df = pit_stops_df.rename(columns={
        'Driver': 'driverId',
        'Lap': 'lap',
        'Duration': 'duration_ms',
    })
    
    return pit_stops_df