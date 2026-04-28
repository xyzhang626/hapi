import { describe, expect, it } from 'bun:test'
import { Store } from '../store'
import { SyncEngine } from './syncEngine'
import { RpcRegistry } from '../socket/rpcRegistry'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * R13-1 regression: scheduled threads are auto-pinned on spawn.
 * After cancel_thread (via MCP or engine.cancelThreadSession), the
 * thread is archived but the pinned chip kept lingering in the channel
 * header pointing to a dead thread. cancelThreadSession now also
 * unpins so the chip strip stays accurate.
 */

function makeEngine() {
    const store = new Store(':memory:')
    const engine = new SyncEngine(
        store,
        { of: () => ({ to: () => ({ emit() {} }) }) } as never,
        new RpcRegistry(),
        { broadcast() {} } as never
    )
    return { store, engine }
}

describe('cancelThreadSession (R13-1)', () => {
    it('unpins the thread when cancelling a pinned (e.g. scheduled) thread', async () => {
        const { store, engine } = makeEngine()
        const channel = store.channels.createChannel('ns1', 'eng', 'u1', undefined, { botName: 'Agent' })
        // Simulate the spawn path: create a thread session with channelId,
        // mark it pinned (as botSpawnThread does for scheduled threads).
        const thread = store.sessions.getOrCreateSession(
            'thr-tag',
            { path: '/tmp' },
            null,
            'ns1',
            undefined,
            undefined,
            undefined,
            { channelId: channel.id, threadTitle: 't1', createdByUserId: 'u1', pinned: true, scheduled: true, schedule: '*/1 * * * *', visibility: 'shared' }
        )
        expect(thread.pinned).toBe(true)
        expect(thread.scheduled).toBe(true)

        await engine.cancelThreadSession(thread.id, 'ns1', 'drill done')

        const after = store.sessions.getSessionByNamespace(thread.id, 'ns1')!
        expect(after.threadStatus).toBe('archived')
        expect(after.pinned).toBe(false) // R13-1: was true before fix
    })

    it('does NOT touch pinned for an already-unpinned regular thread cancel', async () => {
        const { store, engine } = makeEngine()
        const channel = store.channels.createChannel('ns2', 'eng', 'u1', undefined, { botName: 'Agent' })
        const thread = store.sessions.getOrCreateSession(
            'thr-tag-2',
            { path: '/tmp' },
            null,
            'ns2',
            undefined,
            undefined,
            undefined,
            { channelId: channel.id, threadTitle: 't2', createdByUserId: 'u1' } // pinned defaults to false
        )
        expect(thread.pinned).toBe(false)

        await engine.cancelThreadSession(thread.id, 'ns2')

        const after = store.sessions.getSessionByNamespace(thread.id, 'ns2')!
        expect(after.threadStatus).toBe('archived')
        expect(after.pinned).toBe(false) // unchanged
    })

    it('emits an agent_summary card on cancel (regression of R4 fix)', async () => {
        const { store, engine } = makeEngine()
        const channel = store.channels.createChannel('ns3', 'eng', 'u1', undefined, { botName: 'Agent' })
        const thread = store.sessions.getOrCreateSession(
            'thr-tag-3',
            { path: '/tmp' },
            null,
            'ns3',
            undefined,
            undefined,
            undefined,
            { channelId: channel.id, threadTitle: 'task-x', createdByUserId: 'u1' }
        )

        await engine.cancelThreadSession(thread.id, 'ns3', 'reason-text')

        const msgs = store.channelMessages.getMessages(channel.id)
        const summary = msgs.find((m) => m.kind === 'agent_summary')
        expect(summary).toBeTruthy()
        const body = summary!.body as { status?: string; taskTitle?: string; reason?: string }
        expect(body.status).toBe('canceled')
        expect(body.taskTitle).toBe('task-x')
        expect(body.reason).toBe('reason-text')
    })
})

/**
 * R14-2 regression: when a channel is renamed via PUT, channel.name
 * changes but the on-disk workspace folder keeps its ORIGINAL safeName
 * (rename does NOT move the folder — bot/threads are still writing to
 * it). On hard-delete, the cleanup path computed `dir` from the CURRENT
 * channel.name, which doesn't exist on disk — so the folder lingered.
 * Fix uses the bot session's recorded `metadata.path` as a backup
 * candidate.
 */
describe('deleteChannel post-rename folder cleanup (R14-2)', () => {
    it('removes the original workspace folder even when channel was renamed', () => {
        const tmpHapiHome = join(tmpdir(), `hapi-r14-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        mkdirSync(tmpHapiHome, { recursive: true })
        const oldHome = process.env.HAPI_HOME
        process.env.HAPI_HOME = tmpHapiHome
        try {
            const store = new Store(':memory:')
            const engine = new SyncEngine(
                store,
                { of: () => ({ to: () => ({ emit() {} }) }) } as never,
                new RpcRegistry(),
                { broadcast() {} } as never
            )
            const channel = store.channels.createChannel('ns1', 'original-name', 'u1', undefined, { botName: 'A' })
            // Simulate the spawn: a bot session whose metadata.path points
            // at the ORIGINAL safeName workspace folder.
            const originalDir = join(tmpHapiHome, 'workspaces', 'ns1', 'original-name')
            mkdirSync(originalDir, { recursive: true })
            store.sessions.getOrCreateSession(
                'bot-tag',
                { path: originalDir, isChannelBot: true, channelId: channel.id, botName: 'A' },
                null,
                'ns1',
                undefined,
                undefined,
                undefined,
                { channelId: channel.id, isChannelBot: true }
            )
            // Rename the channel (simulating PUT — folder stays put).
            store.channels.updateChannel(channel.id, 'ns1', { name: 'new-name' })

            // Sanity: the workspace folder is at the ORIGINAL name.
            expect(existsSync(originalDir)).toBe(true)
            expect(existsSync(join(tmpHapiHome, 'workspaces', 'ns1', 'new-name'))).toBe(false)

            // Hard delete via the engine.
            engine.deleteChannel(channel.id, 'ns1', { hardDelete: true })

            // R14-2 fix: the original folder is gone, even though the cleanup
            // path's "dir from current channel.name" miss.
            expect(existsSync(originalDir)).toBe(false)
        } finally {
            process.env.HAPI_HOME = oldHome
            try { rmSync(tmpHapiHome, { recursive: true, force: true }) } catch { /* */ }
        }
    })
})
