import os
import sys
import unittest

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from gaps import NOT_CROSSED, generate_gaps_data  # noqa: E402


def _lap(driver, lap_number, lap_time_s=90.0, cumulative_s=None,
         sectors=(30.0, 30.0, 30.0)):
    cumulative = cumulative_s if cumulative_s is not None else lap_number * lap_time_s
    row = {
        'Driver': driver,
        'LapNumber': lap_number,
        'LapTime': pd.Timedelta(seconds=lap_time_s),
        'Time': pd.Timedelta(seconds=cumulative),
    }
    for index, value in enumerate(sectors, start=1):
        row[f'S{index}Time'] = (
            pd.Timedelta(seconds=value) if value is not None else pd.NaT
        )
    return row


def _entry(data, driver_index, lap, checkpoint):
    stride = data['lapCount'] * data['checkpointCount']
    return int(data['crossingTimes'][driver_index * stride + (lap - 1) * data['checkpointCount'] + checkpoint])


class GapsGenerationTest(unittest.TestCase):
    def test_is_deterministic(self):
        laps = pd.DataFrame([_lap('AAA', lap) for lap in range(1, 61)])
        first = generate_gaps_data(laps, ['AAA'], 60)
        second = generate_gaps_data(laps, ['AAA'], 60)
        self.assertTrue(np.array_equal(first['crossingTimes'], second['crossingTimes']))

    def test_indexes_drivers_by_supplied_order(self):
        # Laps arrive in reverse order; the output must still follow driver_order.
        laps = pd.DataFrame([_lap('BBB', 1), _lap('AAA', 1)])
        data = generate_gaps_data(laps, ['AAA', 'BBB'], 1)
        aaa = data['crossingTimes'][0:100]
        bbb = data['crossingTimes'][100:200]
        self.assertNotEqual(int(aaa[-1]), NOT_CROSSED)
        self.assertNotEqual(int(bbb[-1]), NOT_CROSSED)
        self.assertEqual(int(aaa[-1]), 90_000)
        self.assertEqual(int(bbb[-1]), 90_000)

    def test_uses_lap_duration_not_cumulative_race_time(self):
        laps = pd.DataFrame([_lap('AAA', 60, lap_time_s=90.0, cumulative_s=5400.0)])
        data = generate_gaps_data(laps, ['AAA'], 60)
        self.assertEqual(_entry(data, 0, 60, 0), 0)
        self.assertAlmostEqual(_entry(data, 0, 60, 50), 90_000 * 50 / 99, delta=1)
        self.assertEqual(_entry(data, 0, 60, 99), 90_000)
        self.assertLess(_entry(data, 0, 60, 99), 5_400_000)

    def test_crossings_are_monotonic_and_complete(self):
        laps = pd.DataFrame(
            [_lap('AAA', lap, sectors=(25.0, 35.0, 30.0)) for lap in range(1, 4)]
        )
        data = generate_gaps_data(laps, ['AAA'], 3)
        for lap in range(1, 4):
            values = [_entry(data, 0, lap, c) for c in range(100)]
            self.assertTrue(all(a <= b for a, b in zip(values, values[1:])))
            self.assertEqual(values[0], 0)
            self.assertEqual(values[-1], 90_000)

    def test_derives_duration_when_lap_time_missing(self):
        lap = _lap('AAA', 1, lap_time_s=90.0)
        lap['LapTime'] = pd.NaT
        lap['Time'] = pd.Timedelta(seconds=95.0)
        lap['LapStartTime'] = pd.Timedelta(seconds=5.0)
        data = generate_gaps_data(pd.DataFrame([lap]), ['AAA'], 1)
        self.assertEqual(_entry(data, 0, 1, 99), 90_000)

    def test_unknown_drivers_and_missing_laps_stay_not_crossed(self):
        laps = pd.DataFrame([_lap('AAA', 1), _lap('CCC', 2)])
        data = generate_gaps_data(laps, ['AAA', 'BBB', 'CCC'], 3)
        self.assertNotEqual(_entry(data, 2, 2, 99), NOT_CROSSED)
        self.assertEqual(_entry(data, 2, 1, 0), NOT_CROSSED)
        self.assertEqual(_entry(data, 1, 1, 0), NOT_CROSSED)
        self.assertEqual(_entry(data, 0, 2, 0), NOT_CROSSED)


if __name__ == '__main__':
    unittest.main()
