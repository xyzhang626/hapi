import { describe, expect, it } from 'bun:test'
import { Store } from '../store'
import { SyncEngine } from './syncEngine'
import { RpcRegistry } from '../socket/rpcRegistry'

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

describe('botSpawnThread attribution guard', () => {
    it('rejects bot spawn attempts without a recent user strong signal', async () => {
        const { store, engine } = makeEngine()
        const channel = store.channels.createChannel('ns1', 'ops', 'user-1', undefined, { botName: 'Agent' })

        const result = await engine.botSpawnThread(channel.id, 'ns1', 'bot-session-1', {
            title: 'weak-signal-thread',
            prompt: 'Routine weak-signal chatter should not create a thread.'
        })

        if (result.type !== 'error') {
            throw new Error(`Expected error result, got ${result.type}`)
        }
        expect(result.message).toContain('recent user strong signal')
        expect(store.channelMessages.getMessages(channel.id)).toHaveLength(0)
    })
})
