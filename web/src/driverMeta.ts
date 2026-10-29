// Static identity the processed data does not carry: car numbers for the
// 2025/2026 grids. Code is the join key everywhere else in the app.
const CAR_NUMBERS: Record<string, number> = {
  NOR: 1,
  VER: 3,
  BOR: 5,
  HAD: 6,
  DOO: 7,
  GAS: 10,
  PER: 11,
  ANT: 12,
  ALO: 14,
  LEC: 16,
  STR: 18,
  TSU: 22,
  ALB: 23,
  HUL: 27,
  LAW: 30,
  OCO: 31,
  LIN: 41,
  COL: 43,
  HAM: 44,
  SAI: 55,
  RUS: 63,
  BOT: 77,
  PIA: 81,
  BEA: 87,
}

export function carNumberFor(driverId: string): number | null {
  return CAR_NUMBERS[driverId.toUpperCase()] ?? null
}
