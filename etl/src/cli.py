import sys
import os
import argparse


def main():
    parser = argparse.ArgumentParser(description='Pitwall ETL - Process F1 race data')
    parser.add_argument('command', choices=['ingest'], help='Command to run')
    parser.add_argument('year', type=int, help='Race year')
    parser.add_argument('round', type=int, help='Round number')
    parser.add_argument('session', help='Session type (Race, Qualifying, Sprint)')
    parser.add_argument('--fixture', action='store_true', help='Small dataset for fixtures')
    parser.add_argument('--laps', type=int, help='Number of laps per driver for fixture/limit')
    parser.add_argument('--drivers', type=int, default=4, help='Number of drivers for fixture')

    args = parser.parse_args()

    if args.command == 'ingest':
        from writer import write_race
        if args.fixture:
            write_race(args.year, args.round, args.session, driver_count=args.drivers, lap_count=args.laps)
        else:
            write_race(args.year, args.round, args.session, lap_count=args.laps)

    print("Ingest complete")


if __name__ == '__main__':
    main()