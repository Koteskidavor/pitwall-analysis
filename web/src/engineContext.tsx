import React, { createContext, useContext, useSyncExternalStore } from 'react'
import type { EngineSnapshot, SnapshotListener } from './engine'

// The read side of the engine the UI needs. RaceEngine satisfies it, and tests
// can provide a lightweight fake.
export interface EngineSnapshotSource {
  getSnapshot(): EngineSnapshot
  subscribe(listener: SnapshotListener): () => void
}

const EngineContext = createContext<EngineSnapshotSource | null>(null)

export const EngineProvider: React.FC<{
  engine: EngineSnapshotSource
  children: React.ReactNode
}> = ({ engine, children }) => {
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>
}

export function useEngine(): EngineSnapshotSource {
  const engine = useContext(EngineContext)
  if (!engine) throw new Error('useEngine must be used within an EngineProvider')
  return engine
}

export function useEngineSnapshot(): EngineSnapshot {
  const engine = useEngine()
  return useSyncExternalStore(
    (onStoreChange) => engine.subscribe(onStoreChange),
    () => engine.getSnapshot(),
    () => engine.getSnapshot(),
  )
}
