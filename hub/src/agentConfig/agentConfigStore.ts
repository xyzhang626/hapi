import { mkdirSync, readFileSync, writeFileSync, existsSync, watch } from 'node:fs'
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
    private watcher: ReturnType<typeof watch> | null = null
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
    }

    /** Subscribe to file changes (returns unsubscribe). */
    subscribe(listener: Listener): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    /** Start a recursive watcher over basePath. */
    startWatching(): void {
        if (this.watcher) return
        try {
            this.watcher = watch(this.basePath, { recursive: true }, (_eventType, filename) => {
                if (!filename) return
                if (typeof filename !== 'string') return
                if (!filename.endsWith('agent.json')) return
                // filename is relative to basePath, expected: "{channelId}/agent.json"
                const channelId = filename.replace(/[\\/]agent\.json$/, '')
                if (!channelId || channelId.includes('/') || channelId.includes('\\')) return
                this.scheduleNotify(channelId)
            })
        } catch (err) {
            console.error('[AgentConfigStore] watch failed:', err)
            throw err
        }
    }

    stopWatching(): void {
        if (this.watcher) {
            try { this.watcher.close() } catch { /* */ }
            this.watcher = null
        }
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
