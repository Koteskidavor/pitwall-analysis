import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateManifest, validateTrack } from './schemas'

// Lightweight integrity check over the processed data tree. It validates every
// manifest.json / track.json under DATA_ROOT/sessions against the shared
// schemas so a broken ingest is caught before the API serves it.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const configuredRoot = process.env.DATA_ROOT ?? 'data'
const dataRoot = isAbsolute(configuredRoot) ? configuredRoot : join(repoRoot, configuredRoot)
const sessionsDir = join(dataRoot, 'sessions')

function main(): number {
  if (!existsSync(sessionsDir)) {
    console.error(`No sessions directory at ${sessionsDir}`)
    return 1
  }

  const sessions = readdirSync(sessionsDir).filter((entry) =>
    statSync(join(sessionsDir, entry)).isDirectory(),
  )

  if (sessions.length === 0) {
    console.error(`No sessions found in ${sessionsDir}`)
    return 1
  }

  let failures = 0
  for (const session of sessions) {
    for (const [file, validate] of [
      ['manifest.json', validateManifest],
      ['track.json', validateTrack],
    ] as const) {
      const path = join(sessionsDir, session, file)
      if (!existsSync(path)) {
        console.error(`✗ ${session}/${file} is missing`)
        failures += 1
        continue
      }
      try {
        validate(JSON.parse(readFileSync(path, 'utf8')))
        console.log(`✓ ${session}/${file}`)
      } catch (error) {
        console.error(`✗ ${session}/${file}: ${(error as Error).message}`)
        failures += 1
      }
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} file(s) failed validation`)
    return 1
  }
  console.log(`\nValidated ${sessions.length} session(s)`)
  return 0
}

process.exit(main())
