import { describe, expect, it, mock } from 'bun:test'
import { Store } from '../store'
import { SyncEngine } from './syncEngine'
import { RpcRegistry } from '../socket/rpcRegistry'

/**
 * R15-1 regression: when a channel is created with an agentConfig but
 * the initial spawnChannelBot fails (e.g. embedded runner subprocess
 * exited before the RPC handler registered), the channel ends up
 * with botSessionId=NULL. The owner has no in-product way to retry
 * — the AgentConfigEditor PUT path's spawn-on-add guard required
 * `!hadConfig`, which is false here (the channel already has config),
 * so PUT silently does nothing.
 *
 * Fix widened the guard: ALSO retry spawn when the channel still has
 * no bot AND the PUT carries an agentConfig (regardless of whether
 * the channel had config before).
 */
describe('updateChannelData spawn retry (R15-1)', () => {
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

    it('retries spawnChannelBot via PUT when channel has agentConfig but no bot session', () => {
        const { store, engine } = makeEngine()
        // Simulate the orphan state: channel created WITH agentConfig but
        // botSessionId never set (initial spawn failed silently).
        const channel = store.channels.createChannel('ns1', 'eng', 'u1', undefined, { botName: 'A', flavor: 'claude' })
        // Sanity: spawn was attempted but failed (no machine), so
        // botSessionId is null.
        expect(channel.botSessionId).toBeNull()

        const spawnSpy = mock(async () => ({ type: 'success' as const, sessionId: 'new-bot-id' }))
        ;(engine as unknown as { spawnChannelBot: typeof spawnSpy }).spawnChannelBot = spawnSpy

        // Re-PUT the same agentConfig — owner's manual retry trigger.
        engine.updateChannelData(channel.id, 'ns1', { agentConfig: { botName: 'A', flavor: 'claude' } })

        expect(spawnSpy).toHaveBeenCalledTimes(1)
        expect(spawnSpy.mock.calls[0][0]).toBe(channel.id)
        expect(spawnSpy.mock.calls[0][1]).toBe('ns1')
    })

    it('does NOT re-spawn when bot already exists (no duplicates)', () => {
        const { store, engine } = makeEngine()
        const channel = store.channels.createChannel('ns2', 'eng2', 'u1', undefined, { botName: 'A' })
        // Manually set botSessionId to simulate a successfully-spawned bot.
        store.channels.setBotSessionId(channel.id, 'ns2', 'existing-bot-id')

        const spawnSpy = mock(async () => ({ type: 'success' as const, sessionId: 'wont-fire' }))
        ;(engine as unknown as { spawnChannelBot: typeof spawnSpy }).spawnChannelBot = spawnSpy

        // PUT new agentConfig — should NOT re-spawn (bot already exists).
        engine.updateChannelData(channel.id, 'ns2', { agentConfig: { botName: 'B', flavor: 'claude' } })

        expect(spawnSpy).toHaveBeenCalledTimes(0)
    })

    it('still spawns on first-add (hadConfig=false, hasConfig=true) — original spawn-on-add path', () => {
        const { store, engine } = makeEngine()
        const channel = store.channels.createChannel('ns3', 'eng3', 'u1') // NO agentConfig
        expect(channel.agentConfig).toBeNull()

        const spawnSpy = mock(async () => ({ type: 'success' as const, sessionId: 'new-bot' }))
        ;(engine as unknown as { spawnChannelBot: typeof spawnSpy }).spawnChannelBot = spawnSpy

        engine.updateChannelData(channel.id, 'ns3', { agentConfig: { botName: 'A', flavor: 'claude' } })

        expect(spawnSpy).toHaveBeenCalledTimes(1)
    })
})
