import { describe, expect, it, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
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
})
