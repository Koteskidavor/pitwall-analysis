import os
from pathlib import Path

DATA_ROOT = os.environ.get('DATA_ROOT', './data')
CACHE_DIR = os.path.join(str(Path(__file__).parent.parent), '.cache')

RACE_ROOT_TEMPLATE = os.path.join(DATA_ROOT, 'sessions', '{year}_{round}_{session}')

def race_dir(year: int, round: int, session: str) -> Path:
    return Path(RACE_ROOT_TEMPLATE.format(year=year, round=round, session=session.replace(' ', '_')))

def manifest_path(year: int, round: int, session: str) -> Path:
    return Path(os.path.join(race_dir(year, round, session), 'manifest.json'))

def track_path(year: int, round: int, session: str) -> Path:
    return Path(os.path.join(race_dir(year, round, session), 'track.json'))

def motion_path(year: int, round: int, session: str, chunk_num: int) -> Path:
    return Path(os.path.join(race_dir(year, round, session), f'motion/{chunk_num:03d}.bin'))

def gaps_path(year: int, round: int, session: str) -> Path:
    return Path(os.path.join(race_dir(year, round, session), 'gaps.bin'))