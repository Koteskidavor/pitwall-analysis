"""Ingest every completed Race session for a set of seasons.

Rounds are numbered by OpenF1's meeting order (pre-season testing excluded),
which is the numbering the OpenF1-backed fetcher expects.
"""

import argparse
import shutil
import sys
import traceback
from pathlib import Path

if 'etl/src' not in sys.path:
    sys.path.insert(0, 'etl/src')

from openf1 import list_races, openf1_get  # noqa: E402
from paths import race_dir  # noqa: E402
from writer import write_race  # noqa: E402


def ingest_year(year: int, resume: bool = False) -> None:
    races = list_races(year)
    print(f"== {year}: {len(races)} race weekend(s)", flush=True)
    for round_number, meeting, session in races:
        session_key = session['session_key']
        target = race_dir(year, round_number, 'Race')
        label = meeting.get('meeting_name') or meeting.get('location') or f"round {round_number}"
        if resume and race_is_complete(target):
            print(f"skip {year} r{round_number} {label} (already ingested)", flush=True)
            continue
        results = openf1_get(
            f"/session_result?session_key={session_key}",
            cache_key=f"{session_key}_result",
        ) or []
        if not results:
            print(f"skip {year} r{round_number} {label} (no results yet)", flush=True)
            continue
        print(f"ingest {year} r{round_number} {label} ...", flush=True)
        try:
            # Start from a clean directory so schema changes always apply.
            shutil.rmtree(target, ignore_errors=True)
            write_race(year, round_number, 'Race')
            print(f"done {year} r{round_number}", flush=True)
        except Exception:
            print(f"FAILED {year} r{round_number}", flush=True)
            traceback.print_exc()


def race_is_complete(target: Path) -> bool:
    return (target / 'manifest.json').is_file() and (target / 'data.sqlite').is_file()


def main() -> None:
    parser = argparse.ArgumentParser(description='Ingest whole seasons from OpenF1')
    parser.add_argument('years', type=int, nargs='+', help='Season years to ingest')
    parser.add_argument(
        '--resume',
        action='store_true',
        help='Skip sessions that already have a manifest and database',
    )
    args = parser.parse_args()
    for year in args.years:
        ingest_year(year, resume=args.resume)


if __name__ == '__main__':
    main()
