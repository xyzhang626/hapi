import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hapi/protocol/types'
import { Store } from '../store'
import type { EventPublisher } from './eventPublisher'
import { MachineCache } from './machineCache'
import { SessionCache } from './sessionCache'

function createPublisher(events: SyncEvent[]): EventPublisher {
    return {
        emit: (event: SyncEvent) => {
            events.push(event)
        }
    } as unknown as EventPublisher
}

describe('alive incremental events', () => {
    it('includes active=true in session alive updates', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const session = cache.getOrCreateSession(
            'session-alive-test',
            { path: '/tmp/project', host: 'localhost' },
            { requests: {}, completedRequests: {} },
            'default'
        )

        events.length = 0
        cache.handleSessionAlive({ sid: session.id, time: Date.now(), thinking: false })

        const update = events.find((event) => event.type === 'session-updated')
        expect(update).toBeDefined()
        if (!update || update.type !== 'session-updated') {
            return
        }

        expect(update.data).toEqual(expect.objectContaining({ active: true }))
    })

    it('emits full active machine object on machine alive', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new MachineCache(store, createPublisher(events))

        const machine = cache.getOrCreateMachine(
            'machine-alive-test',
            { host: 'localhost', platform: 'linux', happyCliVersion: '0.1.0' },
            null,
            'default'
        )

        events.length = 0
        cache.handleMachineAlive({ machineId: machine.id, time: Date.now() })

        const update = events.find((event) => event.type === 'machine-updated')
        expect(update).toBeDefined()
        if (!update || update.type !== 'machine-updated') {
            return
        }

        expect(update.data).toEqual(expect.objectContaining({ id: machine.id, active: true }))
    })
})

describe('channel-bot-typing event', () => {
    it('fires when a bot session transitions thinking=true', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        // Pre-create a channel so the bot session has a channelId to scope to.
        const channel = store.channels.createChannel('alice', 'eng', 'u1', undefined, { botName: 'Agent' })

        // Create a session marked as channel bot.
        const session = cache.getOrCreateSession(
            'bot-session-test',
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

        // Transition thinking false → true.
        events.length = 0
        cache.handleSessionAlive({ sid: session.id, time: Date.now(), thinking: true })
        const typing = events.find((e) => e.type === 'channel-bot-typing')
        expect(typing).toBeDefined()
        if (typing && typing.type === 'channel-bot-typing') {
            expect(typing.channelId).toBe(channel.id)
            expect(typing.action).toBe('thinking')
        }

        // Transition true → false.
        events.length = 0
        cache.handleSessionAlive({ sid: session.id, time: Date.now() + 1000, thinking: false })
        const idle = events.find((e) => e.type === 'channel-bot-typing')
        expect(idle).toBeDefined()
        if (idle && idle.type === 'channel-bot-typing') {
            expect(idle.action).toBeNull()
        }

        // Stable thinking=false should NOT re-emit (no transition).
        events.length = 0
        cache.handleSessionAlive({ sid: session.id, time: Date.now() + 2000, thinking: false })
        const noEvent = events.find((e) => e.type === 'channel-bot-typing')
        expect(noEvent).toBeUndefined()
    })

    it('does not fire for non-bot sessions', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const session = cache.getOrCreateSession(
            'normal-session',
            { path: '/tmp', host: 'localhost' },
            null,
            'alice'
        )
        expect(session.isChannelBot).toBeFalsy()

        events.length = 0
        cache.handleSessionAlive({ sid: session.id, time: Date.now(), thinking: true })
        const typing = events.find((e) => e.type === 'channel-bot-typing')
        expect(typing).toBeUndefined()
    })

    it('emits action:null when bot session ends', () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const channel = store.channels.createChannel('alice', 'eng2', 'u1', undefined, { botName: 'Agent' })
        const session = cache.getOrCreateSession(
            'bot-end-test',
            { isChannelBot: true, channelId: channel.id, botName: 'Agent' },
            null,
            'alice',
            undefined,
            undefined,
            undefined,
            { channelId: channel.id, isChannelBot: true }
        )
        cache.handleSessionAlive({ sid: session.id, time: Date.now(), thinking: true })

        events.length = 0
        cache.handleSessionEnd({ sid: session.id, time: Date.now() + 1000 })
        const typing = events.find((e) => e.type === 'channel-bot-typing')
        expect(typing).toBeDefined()
        if (typing && typing.type === 'channel-bot-typing') {
            expect(typing.action).toBeNull()
        }
    })
})
