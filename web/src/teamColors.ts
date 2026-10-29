// 2025/2026 constructor colours keyed by driver code. Team colour is the
// primary identity channel in the UI (dots, edges, bars), so it is a fixed
// lookup rather than a hash, and it upgrades cleanly when a season changes.
export interface TeamInfo {
  name: string
  color: string
}

const TEAMS = {
  mclaren: { name: 'McLaren', color: '#f47600' },
  redbull: { name: 'Red Bull Racing', color: '#4781d7' },
  ferrari: { name: 'Ferrari', color: '#ed1131' },
  mercedes: { name: 'Mercedes', color: '#00d7b6' },
  aston: { name: 'Aston Martin', color: '#229971' },
  williams: { name: 'Williams', color: '#1868db' },
  alpine: { name: 'Alpine', color: '#00a1e8' },
  racingbulls: { name: 'Racing Bulls', color: '#6c98ff' },
  haas: { name: 'Haas', color: '#9c9fa2' },
  audi: { name: 'Audi', color: '#f50537' },
  cadillac: { name: 'Cadillac', color: '#909090' },
} as const

const DRIVER_TEAM: Record<string, keyof typeof TEAMS> = {
  NOR: 'mclaren',
  PIA: 'mclaren',
  VER: 'redbull',
  HAD: 'redbull',
  TSU: 'racingbulls',
  LAW: 'racingbulls',
  LIN: 'racingbulls',
  LEC: 'ferrari',
  HAM: 'ferrari',
  RUS: 'mercedes',
  ANT: 'mercedes',
  ALO: 'aston',
  STR: 'aston',
  ALB: 'williams',
  SAI: 'williams',
  GAS: 'alpine',
  COL: 'alpine',
  DOO: 'alpine',
  OCO: 'haas',
  BEA: 'haas',
  HUL: 'audi',
  BOR: 'audi',
  PER: 'cadillac',
  BOT: 'cadillac',
}

const FALLBACK: TeamInfo = { name: 'Unknown', color: '#7d8798' }

export function teamFor(driverId: string): TeamInfo {
  const key = DRIVER_TEAM[driverId.toUpperCase()]
  return key ? TEAMS[key] : FALLBACK
}

export function teamColor(driverId: string): string {
  return teamFor(driverId).color
}
