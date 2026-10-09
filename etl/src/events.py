import pandas as pd
from paths import *

def extract_events(session) -> list:
    """Extract event data from a FastF1 session."""
    session.load()
    events = []
    
    for event in session.events:
        events.append({
            'id': event.get('EventName', ''),
            'timestamp_ms': event.get('Time', 0),
            'type': event.get('EventType', ''),
            'driverId': event.get('Driver', ''),
            'message': event.get('Message', ''),
        })
    
    return events