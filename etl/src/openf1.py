"""OpenF1-backed data source that mimics the small slice of the FastF1
``Session`` API the ETL relies on.

The official F1 live-timing archive that FastF1 reads from is no longer
publicly accessible for recent seasons. OpenF1 (https://openf1.org) exposes
the same underlying timing/telemetry feed and is used here so full telemetry
(motion + gaps) can still be produced for 2024+ seasons.

Only the attributes used by ``writer.py``/``motion.py``/``gaps.py`` are
implemented: ``load``, ``name``, ``session_info``, ``event``, ``laps``,
``results``, ``pos_data``, ``car_data``, ``session_status``,
``track_status``, ``race_control_messages`` and ``get_circuit_info``.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

if 'etl/src' not in sys.path:
    sys.path.insert(0, 'etl/src')

from paths import CACHE_DIR  # noqa: E402

OPENF1_BASE = 'https://api.openf1.org/v1'
# OpenF1 allows a maximum of 3 requests/second on the free tier. Keep a small
# margin so bursts of requests do not trip the limiter.
_MIN_REQUEST_INTERVAL_S = 0.4
_last_request_at = 0.0

_OPENF1_CACHE_DIR = os.path.join(CACHE_DIR, 'openf1')


def _cache_path(key: str) -> Path:
    safe = key.replace('/', '_').replace('?', '_').replace('&', '_').replace('=', '-')
    return Path(_OPENF1_CACHE_DIR) / f"{safe}.json"


def _throttle() -> None:
    global _last_request_at
    elapsed = time.time() - _last_request_at
    if elapsed < _MIN_REQUEST_INTERVAL_S:
        time.sleep(_MIN_REQUEST_INTERVAL_S - elapsed)
    _last_request_at = time.time()


def openf1_get(path: str, cache_key: str | None = None, retries: int = 4):
    """GET an OpenF1 endpoint with disk caching and rate limiting.

    Returns parsed JSON (a list of records) or ``None`` when the endpoint has
    no data for the requested parameters (OpenF1 answers 404 in that case).
    """
    cache_key = cache_key or path
    cached = _cache_path(cache_key)
    if cached.exists():
        try:
            with open(cached, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            cached.unlink(missing_ok=True)

    url = f"{OPENF1_BASE}{path}"
    last_error = None
    for attempt in range(retries):
        _throttle()
        try:
            with urllib.request.urlopen(url, timeout=120) as response:
                raw = response.read().decode('utf-8-sig')
            data = json.loads(raw)
            cached.parent.mkdir(parents=True, exist_ok=True)
            with open(cached, 'w') as f:
                json.dump(data, f)
            return data
        except urllib.error.HTTPError as error:
            if error.code == 404:
                cached.parent.mkdir(parents=True, exist_ok=True)
                with open(cached, 'w') as f:
                    json.dump([], f)
                return []
            if error.code == 429:
                time.sleep(1.0 + attempt)
                last_error = error
                continue
            raise
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
            time.sleep(1.0 + attempt)
    if last_error is not None:
        raise last_error
    return []


def list_meetings(year: int) -> list:
    """Return the year's meetings ordered by their first session date."""
    meetings = openf1_get(f"/meetings?year={year}", cache_key=f"meetings_{year}") or []
    meetings.sort(key=lambda m: m.get('date_start') or '')
    return meetings


def list_races(year: int) -> list:
    """Return ``(round, meeting, session)`` for every Race session in a year.

    Only meetings whose weekend actually has a Race session are counted, so
    pre-season testing does not shift the round numbers.
    """
    sessions = openf1_get(
        f"/sessions?year={year}", cache_key=f"sessions_{year}"
    ) or []
    race_meeting_keys = {
        s.get('meeting_key')
        for s in sessions
        if s.get('session_name') == 'Race'
    }
    meetings = [
        meeting
        for meeting in list_meetings(year)
        if meeting.get('meeting_key') in race_meeting_keys
    ]
    races = []
    for index, meeting in enumerate(meetings, start=1):
        meeting_key = meeting.get('meeting_key')
        candidates = [
            s for s in sessions
            if s.get('meeting_key') == meeting_key and s.get('session_name') == 'Race'
        ]
        if not candidates:
            continue
        session = sorted(candidates, key=lambda s: s.get('date_start') or '')[0]
        races.append((index, meeting, session))
    return races


def _parse_seconds(value):
    """Parse an OpenF1 duration/gap value into seconds.

    Values are usually numeric seconds, but lapped drivers report strings such
    as ``"+1 LAP"`` and some feeds use ``"h:mm:ss.sss"`` clocks.
    """
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text or text.startswith('+') or text.upper().endswith('LAP') or text.upper().endswith('LAPS'):
        return None
    if ':' in text:
        try:
            parts = [float(part) for part in text.split(':')]
        except ValueError:
            return None
        seconds = 0.0
        for part in parts:
            seconds = seconds * 60 + part
        return seconds
    try:
        return float(text)
    except ValueError:
        return None


class _CircuitInfo:
    def __init__(self, corners=None):
        # ``corners`` is consumed with ``len()``/``iterrows()`` by the writer,
        # so expose an (empty) DataFrame rather than ``None``.
        self.corners = corners if corners is not None else pd.DataFrame(
            columns=['Number', 'X', 'Y', 'Angle', 'Distance']
        )


class OpenF1Session:
    """A minimal stand-in for a FastF1 session built from OpenF1 records."""

    def __init__(self, year: int, round: int, session_name: str = 'Race'):
        self.year = year
        self.round = round
        self.session_name = session_name
        self._loaded = False
        self._telemetry_loaded = False
        self._pos_data = None
        self._car_data = None
        self.api_path = f"openf1_{year}_{round}_{session_name}"
        self._resolve_session()

    # -- resolution -------------------------------------------------------

    def _resolve_session(self) -> None:
        races = list_races(self.year)
        match = None
        for index, meeting, session in races:
            if index == self.round:
                match = (meeting, session)
                break
        if match is None:
            raise ValueError(
                f"No OpenF1 Race session for {self.year} round {self.round}"
            )
        self.meeting, self._session_record = match
        self.session_key = self._session_record['session_key']
        self.meeting_key = self._session_record.get('meeting_key')
        # OpenF1's ``meeting_name`` is the official race name (e.g. "Monaco
        # Grand Prix"); the session record only says "Race".
        self.meeting_name = (
            self.meeting.get('meeting_name')
            or self._session_record.get('country_name')
            or self.session_name
        )
        self.event = {
            'Location': self._session_record.get('location')
            or self._session_record.get('circuit_short_name')
            or '',
            'EventName': self.meeting_name,
        }
        self.name = self.meeting_name
        self.date = self._session_record.get('date_start')
        self.session_info = {'Type': self._session_record.get('session_name', 'Race')}

    # -- loading ----------------------------------------------------------

    def load(self, *args, **kwargs) -> None:
        if self._loaded:
            return
        self._raw_drivers = openf1_get(
            f"/drivers?session_key={self.session_key}",
            cache_key=f"{self.session_key}_drivers",
        ) or []
        self._raw_laps = openf1_get(
            f"/laps?session_key={self.session_key}",
            cache_key=f"{self.session_key}_laps",
        ) or []
        self._raw_stints = openf1_get(
            f"/stints?session_key={self.session_key}",
            cache_key=f"{self.session_key}_stints",
        ) or []
        self._raw_pit = openf1_get(
            f"/pit?session_key={self.session_key}",
            cache_key=f"{self.session_key}_pit",
        ) or []
        self._raw_position = openf1_get(
            f"/position?session_key={self.session_key}",
            cache_key=f"{self.session_key}_position",
        ) or []
        self._raw_result = openf1_get(
            f"/session_result?session_key={self.session_key}",
            cache_key=f"{self.session_key}_result",
        ) or []
        self._raw_race_control = openf1_get(
            f"/race_control?session_key={self.session_key}",
            cache_key=f"{self.session_key}_race_control",
        ) or []

        self._build_driver_maps()
        self._build_laps()
        self._build_results()
        self._build_race_control()
        self._build_session_status()
        self._loaded = True

    # -- helpers ----------------------------------------------------------

    def _build_driver_maps(self) -> None:
        self._number_to_code = {}
        self._code_to_number = {}
        self.drivers = []
        for driver in self._raw_drivers:
            number = driver.get('driver_number')
            code = driver.get('name_acronym')
            if number is None or not code:
                continue
            self._number_to_code[int(number)] = code
            self._code_to_number[code] = int(number)
            self.drivers.append(code)

    @staticmethod
    def _ms(value) -> float:
        return float(value)

    def _to_relative_ms(self, iso_timestamp: str | None) -> float | None:
        if not iso_timestamp:
            return None
        dt = pd.Timestamp(iso_timestamp)
        if self._t0 is None:
            self._t0 = dt
        return (dt - self._t0).total_seconds() * 1000.0

    # -- laps -------------------------------------------------------------

    def _build_laps(self) -> None:
        self._t0 = None
        # Establish the lights-out reference from the earliest first-lap start.
        first_laps = [
            pd.Timestamp(lap['date_start'])
            for lap in self._raw_laps
            if lap.get('lap_number') == 1 and lap.get('date_start')
        ]
        if first_laps:
            self._t0 = min(first_laps)
        else:
            dates = [
                pd.Timestamp(lap['date_start'])
                for lap in self._raw_laps
                if lap.get('date_start')
            ]
            self._t0 = min(dates) if dates else pd.Timestamp(0)

        # Index stints and pit stops per driver for quick per-lap lookup.
        stints_by_driver: dict[int, list] = {}
        for stint in self._raw_stints:
            stints_by_driver.setdefault(int(stint['driver_number']), []).append(stint)
        pit_by_driver: dict[int, list] = {}
        for pit in self._raw_pit:
            pit_by_driver.setdefault(int(pit['driver_number']), []).append(pit)

        position_times = []
        position_values = []
        position_drivers = []
        for record in self._raw_position:
            if not record.get('date') or record.get('position') is None:
                continue
            position_times.append(pd.Timestamp(record['date']))
            position_values.append(int(record['position']))
            position_drivers.append(int(record['driver_number']))
        position_df = None
        if position_times:
            position_df = pd.DataFrame(
                {
                    'date': position_times,
                    'position': position_values,
                    'driver_number': position_drivers,
                }
            ).sort_values('date')

        rows = []
        laps_by_driver: dict[int, list] = {}
        for lap in self._raw_laps:
            number = int(lap['driver_number'])
            laps_by_driver.setdefault(number, []).append(lap)
        for number, driver_laps in laps_by_driver.items():
            driver_laps.sort(key=lambda item: item['lap_number'])
            for index, lap in enumerate(driver_laps):
                lap_number = int(lap['lap_number'])
                start = pd.Timestamp(lap['date_start'])
                duration = lap.get('lap_duration')
                if duration is not None:
                    end = start + pd.Timedelta(seconds=float(duration))
                elif index + 1 < len(driver_laps):
                    end = pd.Timestamp(driver_laps[index + 1]['date_start'])
                else:
                    continue
                if pd.isna(start) or pd.isna(end) or end <= start:
                    continue

                code = self._number_to_code.get(number, str(number))

                s1 = lap.get('duration_sector_1')
                s2 = lap.get('duration_sector_2')
                s3 = lap.get('duration_sector_3')

                compound = None
                tyre_age = None
                stint_number = None
                for stint in stints_by_driver.get(number, []):
                    stint_start = stint.get('lap_start')
                    stint_end = stint.get('lap_end')
                    if stint_start is None:
                        continue
                    if stint_start <= lap_number and (stint_end is None or lap_number <= stint_end):
                        compound = stint.get('compound')
                        stint_number = stint.get('stint_number')
                        base = stint.get('tyre_age_at_start')
                        if base is not None:
                            tyre_age = int(base) + (lap_number - int(stint['lap_start']))
                        break

                pit_in_ms = None
                pit_out_ms = None
                for pit in pit_by_driver.get(number, []):
                    if int(pit.get('lap_number', -1)) == lap_number and pit.get('date'):
                        pit_in_ms = (
                            pd.Timestamp(pit['date']) - self._t0
                        ).total_seconds() * 1000.0
                        pit_duration = pit.get('pit_duration') or 0
                        pit_out_ms = pit_in_ms + float(pit_duration) * 1000.0
                        break

                position = None
                if position_df is not None:
                    subset = position_df[position_df['driver_number'] == number]
                    prior = subset[subset['date'] <= end]
                    if not prior.empty:
                        position = int(prior.iloc[-1]['position'])

                rows.append(
                    {
                        'Driver': code,
                        'DriverNumber': number,
                        'LapNumber': lap_number,
                        'LapStartTime': pd.Timedelta(
                            milliseconds=(start - self._t0).total_seconds() * 1000.0
                        ),
                        'Time': pd.Timedelta(
                            milliseconds=(end - self._t0).total_seconds() * 1000.0
                        ),
                        'LapTime': pd.Timedelta(seconds=float(duration)) if duration is not None else pd.NaT,
                        'S1Time': pd.Timedelta(seconds=float(s1)) if s1 is not None else pd.NaT,
                        'S2Time': pd.Timedelta(seconds=float(s2)) if s2 is not None else pd.NaT,
                        'S3Time': pd.Timedelta(seconds=float(s3)) if s3 is not None else pd.NaT,
                        'Position': position,
                        'Compound': compound,
                        'TyreAge': tyre_age,
                        'TyreLife': tyre_age,
                        'Stint': stint_number,
                        'is_accurate': True,
                        'is_pit_in': pit_in_ms is not None,
                        'is_pit_out': bool(lap.get('is_pit_out_lap', False)),
                        'PitInTime': pd.Timedelta(milliseconds=pit_in_ms) if pit_in_ms is not None else pd.NaT,
                        'PitOutTime': pd.Timedelta(milliseconds=pit_out_ms) if pit_out_ms is not None else pd.NaT,
                    }
                )

        self.laps = pd.DataFrame(rows)
        if self.laps.empty:
            self.laps = pd.DataFrame(
                columns=[
                    'Driver', 'DriverNumber', 'LapNumber', 'LapStartTime', 'Time',
                    'LapTime', 'S1Time', 'S2Time', 'S3Time', 'Position', 'Compound',
                    'TyreAge', 'TyreLife', 'Stint', 'is_accurate', 'is_pit_in',
                    'is_pit_out', 'PitInTime', 'PitOutTime',
                ]
            )

    # -- results ----------------------------------------------------------

    def _build_results(self) -> None:
        # OpenF1's /starting_grid is empty for recent races; the first
        # /position record per driver is the effective grid slot.
        starting_grid = {}
        for record in sorted(self._raw_position, key=lambda r: r.get('date') or ''):
            number = record.get('driver_number')
            if number is None or record.get('position') is None:
                continue
            starting_grid.setdefault(int(number), record['position'])

        rows = []
        for result in self._raw_result:
            number = int(result['driver_number'])
            code = self._number_to_code.get(number, str(number))
            position = result.get('position')
            gap_seconds = _parse_seconds(result.get('gap_to_leader'))
            duration_seconds = _parse_seconds(result.get('duration'))
            if position == 1 and duration_seconds is not None:
                time_ms = duration_seconds * 1000.0
            elif gap_seconds is not None:
                time_ms = gap_seconds * 1000.0
            elif duration_seconds is not None:
                time_ms = duration_seconds * 1000.0
            else:
                time_ms = None
            if result.get('dnf') or result.get('dns') or result.get('dsq'):
                status = 'Retired'
            else:
                status = 'Finished'
            rows.append(
                {
                    'Abbreviation': code,
                    'DriverNumber': number,
                    'Position': position,
                    'ClassifiedPosition': position,
                    'Time': pd.Timedelta(milliseconds=time_ms) if time_ms is not None else pd.NaT,
                    'Gap': pd.Timedelta(milliseconds=gap_seconds * 1000.0) if gap_seconds is not None else pd.NaT,
                    'Points': result.get('points') or 0,
                    'Status': status,
                    'GridPosition': starting_grid.get(number),
                }
            )
        rows.sort(key=lambda item: (item['Position'] is None, item['Position']))
        self.results = pd.DataFrame(rows)

    # -- events -----------------------------------------------------------

    def _build_race_control(self) -> None:
        rows = []
        for message in self._raw_race_control:
            if not message.get('date'):
                continue
            relative = (pd.Timestamp(message['date']) - self._t0).total_seconds() * 1000.0
            relative = max(0.0, relative)
            number = message.get('driver_number')
            driver = self._number_to_code.get(int(number)) if number is not None else ''
            rows.append(
                {
                    'Time': pd.Timedelta(milliseconds=relative),
                    'Category': message.get('category') or 'RaceControl',
                    'Driver': driver or '',
                    'Message': message.get('message') or '',
                }
            )
        self.race_control_messages = pd.DataFrame(rows)
        self.track_status = pd.DataFrame(columns=['Time', 'Status', 'Message'])

    def _build_session_status(self) -> None:
        self.session_status = pd.DataFrame(
            [
                {'Status': 'Started', 'Time': pd.Timedelta(0), 'Message': 'Race started'},
                {'Status': 'Finished', 'Time': pd.Timedelta(0), 'Message': 'Race finished'},
            ]
        )

    # -- telemetry --------------------------------------------------------

    def _driver_numbers(self) -> list:
        numbers = []
        for driver in self._raw_drivers:
            if driver.get('driver_number') is not None:
                numbers.append(int(driver['driver_number']))
        return numbers

    def _load_telemetry(self) -> None:
        if self._telemetry_loaded:
            return
        self._pos_data = {}
        self._car_data = {}
        for number in self._driver_numbers():
            location = openf1_get(
                f"/location?session_key={self.session_key}&driver_number={number}",
                cache_key=f"{self.session_key}_location_{number}",
            ) or []
            if location:
                times = [pd.Timestamp(item['date']) for item in location]
                self._pos_data[number] = pd.DataFrame(
                    {
                        'Time': pd.to_timedelta(
                            [(ts - self._t0).total_seconds() * 1000.0 for ts in times],
                            unit='ms',
                        ),
                        'X': [item.get('x', 0.0) for item in location],
                        'Y': [item.get('y', 0.0) for item in location],
                        'Z': [item.get('z', 0.0) for item in location],
                    }
                )
            car = openf1_get(
                f"/car_data?session_key={self.session_key}&driver_number={number}",
                cache_key=f"{self.session_key}_car_data_{number}",
            ) or []
            if car:
                times = [pd.Timestamp(item['date']) for item in car]
                self._car_data[number] = pd.DataFrame(
                    {
                        'Time': pd.to_timedelta(
                            [(ts - self._t0).total_seconds() * 1000.0 for ts in times],
                            unit='ms',
                        ),
                        'Speed': [item.get('speed', 0.0) for item in car],
                    }
                )
        self._telemetry_loaded = True

    # -- FastF1-compatible properties -------------------------------------

    @property
    def pos_data(self):
        self.load()
        self._load_telemetry()
        return self._pos_data

    @property
    def car_data(self):
        self.load()
        self._load_telemetry()
        return self._car_data

    def get_circuit_info(self):
        return _CircuitInfo(corners=None)
