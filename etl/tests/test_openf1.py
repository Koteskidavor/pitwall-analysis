import os
import sys
import unittest

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from openf1 import OpenF1Session  # noqa: E402
from motion import _determine_driver_status, _driver_is_out  # noqa: E402


def _lap(number, start_s, duration_s=None):
    return {
        'lap_number': number,
        'date_start': (
            pd.Timestamp('2026-03-08T04:00:00Z') + pd.Timedelta(seconds=start_s)
        ).isoformat(),
        'lap_duration': duration_s,
    }


class DriverLapTimingsTest(unittest.TestCase):
    def test_splits_a_missing_lap_using_the_typical_duration(self):
        # Lap 1 has no duration and lap 2 is absent; lap 3 starts after 264s.
        # The opening lap absorbs the surplus (a red flag / restart) while lap
        # 2 gets a normal, full-length lap.
        timings = OpenF1Session._driver_lap_timings(
            [_lap(1, 0.0), _lap(3, 264.0, 84.0), _lap(4, 348.0, 84.0)],
            fallback_typical_ms=85_000.0,
        )

        self.assertEqual([entry[0] for entry in timings], [1, 2, 3, 4])
        lap1, lap2, lap3, lap4 = timings
        self.assertAlmostEqual(lap1[3], 264_000.0 - 84_000.0, delta=1)
        self.assertAlmostEqual(lap2[3], 84_000.0, delta=1)
        self.assertEqual(lap2[1], lap1[2])
        self.assertEqual(lap2[2], lap3[1])
        self.assertFalse(lap1[4])
        self.assertFalse(lap2[4])
        self.assertTrue(lap3[4])
        self.assertTrue(lap4[4])

    def test_uses_next_lap_start_for_a_missing_duration_only(self):
        timings = OpenF1Session._driver_lap_timings(
            [_lap(1, 0.0), _lap(2, 188.492, 87.096)],
            fallback_typical_ms=85_000.0,
        )

        self.assertEqual([entry[0] for entry in timings], [1, 2])
        self.assertAlmostEqual(timings[0][3], 188_492.0, delta=1)
        self.assertEqual(timings[0][2], timings[1][1])
        self.assertFalse(timings[0][4])

    def test_distributes_a_gap_after_a_timed_lap(self):
        timings = OpenF1Session._driver_lap_timings(
            [_lap(1, 0.0, 90.0), _lap(3, 200.0, 90.0)],
            fallback_typical_ms=90_000.0,
        )

        self.assertEqual([entry[0] for entry in timings], [1, 2, 3])
        self.assertAlmostEqual(timings[1][3], 110_000.0, delta=1)
        self.assertEqual(timings[1][1], timings[0][2])
        self.assertEqual(timings[1][2], timings[2][1])

    def test_ignores_records_without_a_start(self):
        timings = OpenF1Session._driver_lap_timings(
            [{'lap_number': 1, 'date_start': None, 'lap_duration': None}],
            fallback_typical_ms=85_000.0,
        )
        self.assertEqual(timings, [])


class _FakeSession:
    def __init__(self, laps, results):
        self.laps = laps
        self.results = results

    def load(self):
        pass


class DriverStatusTest(unittest.TestCase):
    def test_dns_driver_is_out_for_the_whole_session(self):
        session = _FakeSession(
            laps=pd.DataFrame(
                columns=['Driver', 'LapNumber', 'Time', 'PitInTime', 'PitOutTime']
            ),
            results=pd.DataFrame(
                [
                    {
                        'Abbreviation': 'HUL',
                        'Status': 'Did Not Start',
                        'Laps': 0,
                    }
                ]
            ),
        )

        self.assertTrue(_driver_is_out(session, 'HUL'))
        status = _determine_driver_status(
            session, 'HUL', 0, 60_000, ['HUL'], 0
        )
        self.assertTrue(np.all(status == 2))

    def test_running_driver_is_not_out(self):
        session = _FakeSession(
            laps=pd.DataFrame(
                columns=['Driver', 'LapNumber', 'Time', 'PitInTime', 'PitOutTime']
            ),
            results=pd.DataFrame(
                [
                    {
                        'Abbreviation': 'RUS',
                        'Status': 'Finished',
                        'Laps': 58,
                    }
                ]
            ),
        )

        self.assertFalse(_driver_is_out(session, 'RUS'))
        status = _determine_driver_status(
            session, 'RUS', 0, 60_000, ['RUS'], 0
        )
        self.assertTrue(np.all(status == 0))


if __name__ == '__main__':
    unittest.main()
