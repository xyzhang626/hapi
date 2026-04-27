import { describe, expect, it, mock } from 'bun:test'
import { Store } from '../store'
import { SyncEngine } from './syncEngine'
import { RpcRegistry } from '../socket/rpcRegistry'

/**
 * Stage 2 item #4: bot crash recovery watchdog.
 *
 * When a session marked is_channel_bot=true emits session-end, hub
 * should schedule a respawn with the previous sessionId so the
 * bot's transcript is preserved across the crash. The schedule
 * should NOT fire for non-bot sessions or sessions without channel
 * scoping.
 */

function makeEngine() {
    const store = new Store(':memory:')
    const engine = new SyncEngine(
        store,
        { of: () => ({ to: () => ({ emit() {} }) }) } as never,
        new RpcRegistry(),
        { broadcast() {} } as never
    )
    // Drive the watchdog synchronously instead of waiting 5s.
    engine.setBotWatchdogRestartDelayMsForTesting(0)
    return { store, engine }
}

describe('channel-bot watchdog (stage 2 #4)', () => {
    it('reschedules spawnChannelBot with resumeSessionId when a bot session ends', async () => {
        const { store, engine } = makeEngine()
        const channel = store.channels.createChannel('alice', 'eng', 'u1', undefined, { botName: 'Agent' })

        // Pre-create a session row that looks like a channel bot.
        const session = store.sessions.getOrCreateSession(
            'bot-tag-1',
            { isChannelBot: true, channelId: channel.id, botName: 'Agent' },
            null,
            'alice',
            undefined,
            undefined,
            undefined,
            { channelId: channel.id, isChannelBot: true }
        )
        expect(session.isChannelBot).toBe(true)
        expect(session.channelId).toBe(channel.id)

        // Mark the session active so handleSessionEnd does meaningful work.
        engine.handleSessionAlive({ sid: session.id, time: Date.now(), thinking: false })

        // Spy on spawnChannelBot — replace it with a mock that captures
        // the call args, returns 'success' so the .catch() doesn't fire.
        const spawnSpy = mock(async (_channelId: string, _namespace: string, _opts?: { resumeSessionId?: string }) => {
            return { type: 'success' as const, sessionId: 'new-bot-session-id' }
        })
        ;(engine as unknown as { spawnChannelBot: typeof spawnSpy }).spawnChannelBot = spawnSpy

        // Trigger the end event; watchdog should fire (delay=0) the spawn.
        engine.handleSessionEnd({ sid: session.id, time: Date.now() + 1000 })

        // Yield to the event loop so setTimeout(0) fires.
        await new Promise((r) => setTimeout(r, 30))

        expect(spawnSpy).toHaveBeenCalledTimes(1)
        const args = spawnSpy.mock.calls[0]
        expect(args[0]).toBe(channel.id)
        expect(args[1]).toBe('alice')
        expect(args[2]).toEqual({ resumeSessionId: session.id })
    })

    it('does NOT respawn when a non-bot session ends', async () => {
        const { store, engine } = makeEngine()

        const session = store.sessions.getOrCreateSession(
            'normal-tag',
            { path: '/tmp/x', host: 'localhost' },
            null,
            'alice'
        )
        expect(session.isChannelBot).toBe(false)
        engine.handleSessionAlive({ sid: session.id, time: Date.now(), thinking: false })

        const spawnSpy = mock(async () => ({ type: 'success' as const, sessionId: 'X' }))
        ;(engine as unknown as { spawnChannelBot: typeof spawnSpy }).spawnChannelBot = spawnSpy

        engine.handleSessionEnd({ sid: session.id, time: Date.now() + 1000 })
        await new Promise((r) => setTimeout(r, 30))

        expect(spawnSpy).not.toHaveBeenCalled()
    })

    it('does NOT respawn when bot session has no channelId (corrupt row)', async () => {
        const { store, engine } = makeEngine()

        const session = store.sessions.getOrCreateSession(
            'broken-bot-tag',
            { isChannelBot: true },
            null,
            'alice',
            undefined,
            undefined,
            undefined,
            { isChannelBot: true } // no channelId
        )
        expect(session.isChannelBot).toBe(true)
        expect(session.channelId == null).toBe(true) // null or undefined; both mean "no channel"
        engine.handleSessionAlive({ sid: session.id, time: Date.now(), thinking: false })

        const spawnSpy = mock(async () => ({ type: 'success' as const, sessionId: 'X' }))
        ;(engine as unknown as { spawnChannelBot: typeof spawnSpy }).spawnChannelBot = spawnSpy

        engine.handleSessionEnd({ sid: session.id, time: Date.now() + 1000 })
        await new Promise((r) => setTimeout(r, 30))

        expect(spawnSpy).not.toHaveBeenCalled()
    })

    it('preserves resumeSessionId across multiple end-respawn cycles', async () => {
        const { store, engine } = makeEngine()
        const channel = store.channels.createChannel('alice', 'eng-2', 'u1', undefined, { botName: 'Agent' })
        const session = store.sessions.getOrCreateSession(
            'bot-tag-multi',
            { isChannelBot: true, channelId: channel.id },
            null,
            'alice',
            undefined,
            undefined,
            undefined,
            { channelId: channel.id, isChannelBot: true }
        )
        engine.handleSessionAlive({ sid: session.id, time: Date.now(), thinking: false })

        const calls: Array<{ resumeSessionId?: string }> = []
        const spawnSpy = mock(async (_c: string, _n: string, opts?: { resumeSessionId?: string }) => {
            calls.push(opts ?? {})
            return { type: 'success' as const, sessionId: 'X' }
        })
        ;(engine as unknown as { spawnChannelBot: typeof spawnSpy }).spawnChannelBot = spawnSpy

        engine.handleSessionEnd({ sid: session.id, time: Date.now() + 1000 })
        await new Promise((r) => setTimeout(r, 30))
        engine.handleSessionEnd({ sid: session.id, time: Date.now() + 2000 })
        await new Promise((r) => setTimeout(r, 30))

        expect(spawnSpy).toHaveBeenCalledTimes(2)
        expect(calls[0].resumeSessionId).toBe(session.id)
        expect(calls[1].resumeSessionId).toBe(session.id)
    })
})
