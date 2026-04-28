import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, statSync, watch } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/**
 * AgentConfig file store (Stage 2).
 *
 * Each channel's agent config lives at:
 *   {basePath}/{channelId}/agent.json
 *
 * The DB still carries a cached snapshot in channels.agent_config; this
 * store is for editable persistence. On file changes (manual edit or
 * via API), an event is emitted so the SyncEngine can inject a
 * __config_updated message into the bot session and refresh the cache.
 *
 * Watcher strategy: Bun's `fs.watch({ recursive: true })` on Linux only
 * fires events for files in the *immediate* watched directory — nested
 * files inside subdirs are silently dropped (verified: external `echo >`
 * to nested file produces no event). So we maintain a parent recursive
 * watcher (catches new channelId subdir creation) PLUS per-channel
 * non-recursive watchers (catches subsequent file modifications). The
 * write() / scan-on-start paths register each per-channel watcher.
 *
 * Principle: no fallbacks. Read failures throw.
 */

export type AgentConfigChange = {
    channelId: string
    config: unknown
    rawText: string
}

type Listener = (change: AgentConfigChange) => void

export class AgentConfigStore {
    private readonly basePath: string
    private readonly listeners: Set<Listener> = new Set()
    private parentWatcher: ReturnType<typeof watch> | null = null
    private readonly channelWatchers: Map<string, ReturnType<typeof watch>> = new Map()
    private readonly debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

    constructor(basePath?: string) {
        this.basePath = basePath ?? join(process.env.HAPI_HOME ?? join(homedir(), '.hapi'), 'channels')
        mkdirSync(this.basePath, { recursive: true, mode: 0o700 })
    }

    pathFor(channelId: string): string {
        return join(this.basePath, channelId, 'agent.json')
    }

    read(channelId: string): unknown | null {
        const p = this.pathFor(channelId)
        if (!existsSync(p)) return null
        const raw = readFileSync(p, 'utf-8')
        if (!raw.trim()) return null
        return JSON.parse(raw)
    }

    write(channelId: string, config: unknown): void {
        const p = this.pathFor(channelId)
        mkdirSync(dirname(p), { recursive: true, mode: 0o700 })
        writeFileSync(p, JSON.stringify(config, null, 2), { mode: 0o600 })
        // Bun fs.watch recursive misses nested-file events on Linux, so attach
        // a per-channel non-recursive watcher right after we create the subdir.
        // Idempotent: addChannelWatcher exits if one already exists.
        this.addChannelWatcher(channelId)
    }

    delete(channelId: string): void {
        const p = this.pathFor(channelId)
        if (existsSync(p)) {
            try {
                require('node:fs').rmSync(p)
            } catch {
                // best-effort
            }
        }
        // Tear down the per-channel watcher; the agentConfig is gone.
        const w = this.channelWatchers.get(channelId)
        if (w) {
            try { w.close() } catch { /* */ }
            this.channelWatchers.delete(channelId)
        }
    }

    /** Subscribe to file changes (returns unsubscribe). */
    subscribe(listener: Listener): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    /** Start the parent (subdir-creation) watcher and rehydrate per-channel watchers. */
    startWatching(): void {
        if (this.parentWatcher) return
        try {
            // Recursive flag: catches the *creation* of new channelId subdirs
            // (Bun fires `rename` for the subdir name itself). We then attach
            // a dedicated per-channel watcher for subsequent file changes.
            this.parentWatcher = watch(this.basePath, { recursive: true }, (_eventType, filename) => {
                if (!filename) return
                if (typeof filename !== 'string') return
                // Two cases the parent watcher catches:
                //   1. A new channelId subdir was created → attach per-channel watcher.
                //   2. The agent.json file in the *parent* dir itself was touched
                //      (rare, defensive). Notify if it matches the per-channel pattern.
                const channelIdFromFile = filename.endsWith('agent.json')
                    ? filename.replace(/[\\/]agent\.json$/, '')
                    : filename
                if (!channelIdFromFile || channelIdFromFile.includes('/') || channelIdFromFile.includes('\\')) return
                // Always re-arm the per-channel watcher; addChannelWatcher is idempotent.
                this.addChannelWatcher(channelIdFromFile)
                if (filename.endsWith('agent.json')) {
                    this.scheduleNotify(channelIdFromFile)
                }
            })
            // Rehydrate per-channel watchers for any agent.json files already on disk
            // (e.g. hub restarted with existing channels).
            this.rehydrateChannelWatchers()
        } catch (err) {
            console.error('[AgentConfigStore] watch failed:', err)
            throw err
        }
    }

    private rehydrateChannelWatchers(): void {
        let entries: string[]
        try {
            entries = readdirSync(this.basePath)
        } catch {
            return
        }
        for (const entry of entries) {
            const sub = join(this.basePath, entry)
            try {
                if (!statSync(sub).isDirectory()) continue
            } catch {
                continue
            }
            this.addChannelWatcher(entry)
        }
    }

    private addChannelWatcher(channelId: string): void {
        if (this.channelWatchers.has(channelId)) return
        const dir = join(this.basePath, channelId)
        if (!existsSync(dir)) return
        try {
            const w = watch(dir, (_eventType, _filename) => {
                // Notify on ANY event in the channel dir. Filtering by
                // `filename === 'agent.json'` was too strict — atomic editors
                // (sed -i, vim's `:w`, many JSON formatters) write to a temp
                // file then rename, producing fs.watch events with the temp
                // file's name (e.g. `sedHfqpYR`). scheduleNotify re-reads
                // agent.json from disk and only emits if it parses cleanly,
                // so spurious events on unrelated files (none expected in
                // this dir) are no-ops.
                this.scheduleNotify(channelId)
            })
            this.channelWatchers.set(channelId, w)
        } catch (err) {
            console.error(`[AgentConfigStore] failed to attach watcher for ${channelId}:`, err)
        }
    }

    stopWatching(): void {
        if (this.parentWatcher) {
            try { this.parentWatcher.close() } catch { /* */ }
            this.parentWatcher = null
        }
        for (const w of this.channelWatchers.values()) {
            try { w.close() } catch { /* */ }
        }
        this.channelWatchers.clear()
        for (const t of this.debounceTimers.values()) clearTimeout(t)
        this.debounceTimers.clear()
    }

    private scheduleNotify(channelId: string): void {
        // Coalesce rapid editor saves (multiple fs events per save)
        const existing = this.debounceTimers.get(channelId)
        if (existing) clearTimeout(existing)
        this.debounceTimers.set(channelId, setTimeout(() => {
            this.debounceTimers.delete(channelId)
            try {
                const p = this.pathFor(channelId)
                if (!existsSync(p)) return
                const rawText = readFileSync(p, 'utf-8')
                if (!rawText.trim()) return
                const config = JSON.parse(rawText)
                for (const l of this.listeners) {
                    try { l({ channelId, config, rawText }) } catch (err) {
                        console.error('[AgentConfigStore] listener error:', err)
                    }
                }
            } catch (err) {
                console.error('[AgentConfigStore] notify read failed:', err)
            }
        }, 250))
    }
}
