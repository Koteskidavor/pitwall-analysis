// Stable per-driver colour. Cars keep the same colour across frames and panels.
// Team colours are the primary identity; the hash palette is only a fallback
// for unknown codes (test fixtures, future entrants).
import { teamColor } from './teamColors'

const DRIVER_PALETTE = [
  '#e6194b',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#46f0f0',
  '#f032e6',
  '#bcf60c',
  '#fabebe',
  '#008080',
  '#e6beff',
  '#9a6324',
  '#800000',
  '#808000',
  '#000075',
  '#808080',
]

export function driverColor(driverId: string): string {
  const team = teamColor(driverId)
  if (team !== '#7d8798') return team

  let hash = 0
  for (let i = 0; i < driverId.length; i++) {
    hash = (hash * 31 + driverId.charCodeAt(i)) | 0
  }
  return DRIVER_PALETTE[Math.abs(hash) % DRIVER_PALETTE.length]
}
