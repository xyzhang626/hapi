import { describe, expect, it, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentConfigStore } from './agentConfigStore'

function tempBase(): string {
    const dir = join(tmpdir(), `hapi-agent-config-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    return dir
}

describe('AgentConfigStore', () => {
    let baseDir: string | null = null
    let store: AgentConfigStore | null = null
    afterEach(() => {
        store?.stopWatching()
        store = null
        if (baseDir) {
            try { rmSync(baseDir, { recursive: true, force: true }) } catch { /* */ }
        }
        baseDir = null
    })

    it('write then read round-trips', () => {
        baseDir = tempBase()
        store = new AgentConfigStore(baseDir)
        const ch = 'ch-1'
        store.write(ch, { flavor: 'claude', botName: 'Agent' })
        const got = store.read(ch) as { flavor: string; botName: string }
        expect(got.flavor).toBe('claude')
        expect(got.botName).toBe('Agent')
    })

    it('read returns null when no file exists', () => {
        baseDir = tempBase()
        store = new AgentConfigStore(baseDir)
        expect(store.read('nonexistent')).toBeNull()
    })

    it('subscribe is invoked when file is changed externally', async () => {
        baseDir = tempBase()
        store = new AgentConfigStore(baseDir)
        store.startWatching()
        const ch = 'ch-2'
        store.write(ch, { foo: 'bar' })

        const events: any[] = []
        store.subscribe((c) => events.push(c))

        // External edit
        await new Promise((r) => setTimeout(r, 100))
        store.write(ch, { foo: 'baz', extra: true })
        // Wait for debounce + watcher
        await new Promise((r) => setTimeout(r, 600))
        expect(events.length).toBeGreaterThan(0)
        const last = events[events.length - 1]
        expect(last.channelId).toBe(ch)
        expect(last.config.foo).toBe('baz')
    }, 5000)

    it('pathFor builds expected path', () => {
        baseDir = tempBase()
        store = new AgentConfigStore(baseDir)
        const p = store.pathFor('abc-123')
        expect(p).toContain('abc-123')
        expect(p).toContain('agent.json')
    })

    // R9 regression: editors that do atomic write (sed -i, vim :w, many JSON
    // formatters) write to a temp file then rename. The fs.watch callback
    // receives the temp filename, NOT 'agent.json'. The previous filter
    // `if (!filename.endsWith('agent.json')) return` silently dropped these
    // events, so on-disk hot-reload was DOA for any editor that's not a
    // direct-write tool. The fix notifies on ANY event in the channel dir
    // and re-reads agent.json from disk.
    it('subscribe fires on atomic temp-then-rename file edit', async () => {
        baseDir = tempBase()
        store = new AgentConfigStore(baseDir)
        store.startWatching()
        const ch = 'ch-atomic'
        store.write(ch, { botName: 'Compass' })

        const events: { config: { botName?: string } }[] = []
        store.subscribe((c) => events.push(c as { config: { botName?: string } }))

        // Atomic edit: write tempfile, then rename to agent.json (same as
        // sed -i, vim's `:w`, and most editors with crash-safety enabled).
        await new Promise((r) => setTimeout(r, 100))
        const dir = join(baseDir, ch)
        const tmp = join(dir, '.agent.json.tmp')
        writeFileSync(tmp, JSON.stringify({ botName: 'Captain' }))
        renameSync(tmp, join(dir, 'agent.json'))

        await new Promise((r) => setTimeout(r, 600))
        expect(events.length).toBeGreaterThan(0)
        const last = events[events.length - 1]
        expect(last.config.botName).toBe('Captain')
    }, 5000)
})
