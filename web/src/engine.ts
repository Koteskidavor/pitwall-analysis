import { type Manifest } from '../../shared/src/schemas'
import { decodeMotionChunk, type MotionChunk } from '../../shared/src/binary-decoder'

export const DRIVER_STATUS = {
    RUNNING: 0,
    PIT: 1,
    OUT: 2,
} as const

export interface MotionSample {
    driverId: string
    progress: number
    x: number
    y: number
    speed: number
    status: number
}

export interface EngineSnapshot {
    timeMs: number
    durationMs: number
    playing: boolean
    ended: boolean
    ready: boolean
    samples: MotionSample[]
}

export type ChunkLoader = (chunkIndex: number) => Promise<ArrayBuffer>
export type SnapshotListener = (snapshot: EngineSnapshot) => void

export interface RaceEngineOptions {
    manifest: Manifest
    loadChunk: ChunkLoader
    cacheSize?: number
    prefetchDepth?: number
}

function clamp(value: number, min: number, max: number): number {
    if (value < min) return min
    if (value > max) return max
    return value
}

function lerp(from: number, to: number, t: number): number {
    return from + (to - from) * t
}

class LruCache {
    private readonly entries = new Map<number, MotionChunk>()

    constructor(private readonly capacity: number) { }

    get(index: number): MotionChunk | undefined {
        const chunk = this.entries.get(index)
        if (chunk !== undefined) {
            this.entries.delete(index)
            this.entries.set(index, chunk)
        }
        return chunk
    }

    set(index: number, chunk: MotionChunk): void {
        if (this.entries.has(index)) this.entries.delete(index)
        this.entries.set(index, chunk)
        while (this.entries.size > this.capacity) {
            const oldest = this.entries.keys().next().value
            if (oldest === undefined) break
            this.entries.delete(oldest)
        }
    }

    indices(): number[] {
        return [...this.entries.keys()]
    }

    get size(): number {
        return this.entries.size
    }
}

export class RaceEngine {
    private readonly manifest: Manifest
    private readonly loadChunk: ChunkLoader
    private readonly cache: LruCache
    private readonly prefetchDepth: number
    private readonly stepsPerChunk: number
    private readonly stepMs: number
    private readonly totalSteps: number
    private readonly lastStep: number

    private readonly pending = new Map<number, Promise<MotionChunk>>()
    private readonly listeners = new Set<SnapshotListener>()

    private timeMs = 0
    private playing = false
    private ended = false

    constructor(options: RaceEngineOptions) {
        const { manifest, loadChunk, cacheSize = 8, prefetchDepth = 2 } = options

        if (manifest.sampleHz <= 0) throw new Error('manifest.sampleHz must be positive')
        if (manifest.chunkCount < 0) throw new Error('manifest.chunkCount must be non-negative')

        this.manifest = manifest
        this.loadChunk = loadChunk
        this.cache = new LruCache(Math.max(1, cacheSize))
        this.prefetchDepth = Math.max(0, prefetchDepth)
        this.stepsPerChunk = Math.max(1, Math.round(manifest.chunkSeconds * manifest.sampleHz))
        this.stepMs = 1000 / manifest.sampleHz
        this.totalSteps = manifest.chunkCount * this.stepsPerChunk
        this.lastStep = Math.max(0, this.totalSteps - 1)
    }

    get durationMs(): number {
        return this.manifest.durationMs
    }

    get currentTimeMs(): number {
        return this.timeMs
    }

    get isPlaying(): boolean {
        return this.playing
    }

    get driverOrder(): string[] {
        return this.manifest.driverOrder
    }

    getLoadedChunkIndices(): number[] {
        return this.cache.indices()
    }

    seek(timeMs: number): void {
        this.setTime(timeMs)
        this.prime()
        this.publish()
    }

    rewind(deltaMs: number): void {
        this.seek(this.timeMs - Math.abs(deltaMs))
    }

    play(): void {
        if (this.timeMs >= this.durationMs && this.durationMs > 0) {
            this.setTime(0)
        }
        this.playing = true
        this.ended = false
        this.prime()
        this.publish()
    }

    pause(): void {
        if (!this.playing) return
        this.playing = false
        this.publish()
    }

    tick(deltaMs: number): void {
        if (!this.playing) return
        const next = this.timeMs + deltaMs
        if (next >= this.durationMs) {
            this.setTime(this.durationMs)
            this.ended = true
            this.playing = false
        } else {
            this.setTime(next)
        }
        this.prime()
        this.publish()
    }

    sample(timeMs: number = this.timeMs): MotionSample[] | null {
        const clamped = clamp(timeMs, 0, this.durationMs)
        this.prime(clamped)

        const fromStep = this.stepIndexAt(clamped)
        const toStep = Math.min(fromStep + 1, this.lastStep)
        const fromChunkIndex = this.chunkIndexForStep(fromStep)
        const toChunkIndex = this.chunkIndexForStep(toStep)

        const fromChunk = this.cache.get(fromChunkIndex)
        const toChunk = toChunkIndex === fromChunkIndex ? fromChunk : this.cache.get(toChunkIndex)
        if (!fromChunk || !toChunk) return null

        const fromLocal = fromStep - fromChunkIndex * this.stepsPerChunk
        const toLocal = toStep - toChunkIndex * this.stepsPerChunk
        const t = fromStep === toStep ? 0 : (clamped - fromStep * this.stepMs) / this.stepMs

        const samples: MotionSample[] = []
        for (let d = 0; d < this.manifest.driverOrder.length; d++) {
            const fromIndex = d * this.stepsPerChunk + fromLocal
            const toIndex = d * this.stepsPerChunk + toLocal
            samples.push({
                driverId: this.manifest.driverOrder[d],
                progress: lerp(fromChunk.progress[fromIndex], toChunk.progress[toIndex], t),
                x: lerp(fromChunk.x[fromIndex], toChunk.x[toIndex], t),
                y: lerp(fromChunk.y[fromIndex], toChunk.y[toIndex], t),
                speed: lerp(fromChunk.speed[fromIndex], toChunk.speed[toIndex], t),
                status: fromChunk.status[fromIndex],
            })
        }
        return samples
    }

    getSnapshot(): EngineSnapshot {
        const samples = this.sample(this.timeMs)
        return {
            timeMs: this.timeMs,
            durationMs: this.durationMs,
            playing: this.playing,
            ended: this.ended,
            ready: samples !== null,
            samples: samples ?? [],
        }
    }

    subscribe(listener: SnapshotListener): () => void {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    async whenReady(timeMs: number = this.timeMs): Promise<void> {
        const clamped = clamp(timeMs, 0, this.durationMs)
        this.prime(clamped)

        const fromStep = this.stepIndexAt(clamped)
        const toStep = Math.min(fromStep + 1, this.lastStep)
        const wanted = new Set<number>([
            this.chunkIndexForStep(fromStep),
            this.chunkIndexForStep(toStep),
        ])

        const promises: Promise<MotionChunk>[] = []
        for (const index of wanted) {
            const promise = this.ensureChunk(index)
            if (promise) promises.push(promise)
        }
        await Promise.all(promises)
    }

    private setTime(timeMs: number): void {
        this.timeMs = clamp(timeMs, 0, this.durationMs)
        if (this.timeMs >= this.durationMs && this.durationMs > 0) {
            this.ended = true
            this.playing = false
        } else {
            this.ended = false
        }
    }

    private stepIndexAt(timeMs: number): number {
        return clamp(Math.floor(timeMs / this.stepMs), 0, this.lastStep)
    }

    private chunkIndexForStep(step: number): number {
        const index = Math.floor(step / this.stepsPerChunk)
        return clamp(index, 0, Math.max(0, this.manifest.chunkCount - 1))
    }

    private prime(timeMs: number = this.timeMs): void {
        const chunk = this.chunkIndexForStep(this.stepIndexAt(timeMs))
        for (let offset = 0; offset <= this.prefetchDepth; offset++) {
            const index = chunk + offset
            if (index >= this.manifest.chunkCount) break
            const promise = this.ensureChunk(index)
            if (promise) void promise.catch(() => undefined)
        }
    }

    private ensureChunk(index: number): Promise<MotionChunk> | null {
        if (index < 0 || index >= this.manifest.chunkCount) return null

        const cached = this.cache.get(index)
        if (cached) return Promise.resolve(cached)

        const inFlight = this.pending.get(index)
        if (inFlight) return inFlight

        const promise = this.loadChunk(index)
            .then((buffer) => {
                const chunk = decodeMotionChunk(buffer, this.manifest.driverOrder.length, this.stepsPerChunk)
                this.cache.set(index, chunk)
                return chunk
            })
            .finally(() => {
                this.pending.delete(index)
                this.publish()
            })

        this.pending.set(index, promise)
        return promise
    }

    private publish(): void {
        if (this.listeners.size === 0) return
        const snapshot = this.getSnapshot()
        for (const listener of this.listeners) listener(snapshot)
    }
}
