import { describe, expect, it } from 'bun:test'
import { Store } from '../store'
import { ChannelCache } from './channelCache'
import { EventPublisher } from './eventPublisher'
import { SSEManager } from '../sse/sseManager'
import { VisibilityTracker } from '../visibility/visibilityTracker'
import type { SyncEvent } from '@hapi/protocol/types'

function createTestCache() {
    const store = new Store(':memory:')
    const visibilityTracker = new VisibilityTracker()
    const sseManager = new SSEManager(0, visibilityTracker)
    const events: SyncEvent[] = []
    const publisher = new EventPublisher(sseManager, (e) => e.namespace)
    publisher.subscribe((e) => events.push(e))
    const cache = new ChannelCache(store, publisher)
    return { store, cache, events }
}

describe('ChannelCache', () => {
    describe('reloadAll', () => {
        it('loads all channels and membership from store', () => {
            const { store, cache } = createTestCache()
            const ch1 = store.channels.createChannel('ns1', 'general', 'user-1')
            store.channels.addMember(ch1.id, 'user-1', 'owner')
            const ch2 = store.channels.createChannel('ns1', 'dev', 'user-1')
            store.channels.addMember(ch2.id, 'user-1', 'owner')
            store.channels.addMember(ch2.id, 'user-2', 'member')

            cache.reloadAll()

            expect(cache.getChannel(ch1.id, 'ns1')).not.toBeNull()
            expect(cache.getChannel(ch2.id, 'ns1')).not.toBeNull()
            expect(cache.isMember(ch1.id, 'user-1')).toBe(true)
            expect(cache.isMember(ch1.id, 'user-2')).toBe(false)
            expect(cache.isMember(ch2.id, 'user-1')).toBe(true)
            expect(cache.isMember(ch2.id, 'user-2')).toBe(true)
        })

        it('clears stale data on reload', () => {
            const { store, cache } = createTestCache()
            const ch = store.channels.createChannel('ns1', 'temp', 'user-1')
            store.channels.addMember(ch.id, 'user-1', 'owner')
            cache.reloadAll()
            expect(cache.getChannel(ch.id, 'ns1')).not.toBeNull()

            store.channels.deleteChannel(ch.id, 'ns1')
            cache.reloadAll()
            expect(cache.getChannel(ch.id, 'ns1')).toBeNull()
        })
    })

    describe('getChannel', () => {
        it('returns null for wrong namespace', () => {
            const { store, cache } = createTestCache()
            const ch = store.channels.createChannel('ns1', 'test', 'user-1')
            cache.reloadAll()

            expect(cache.getChannel(ch.id, 'ns1')).not.toBeNull()
            expect(cache.getChannel(ch.id, 'ns2')).toBeNull()
        })

        it('returns null for non-existent channel', () => {
            const { cache } = createTestCache()
            cache.reloadAll()
            expect(cache.getChannel('non-existent', 'ns1')).toBeNull()
        })
    })

    describe('getChannelNamespace', () => {
        it('returns namespace for cached channel', () => {
            const { store, cache } = createTestCache()
            const ch = store.channels.createChannel('ns1', 'test', 'user-1')
            cache.reloadAll()
            expect(cache.getChannelNamespace(ch.id)).toBe('ns1')
        })

        it('returns undefined for non-existent channel', () => {
            const { cache } = createTestCache()
            cache.reloadAll()
            expect(cache.getChannelNamespace('non-existent')).toBeUndefined()
        })
    })

    describe('getChannelsForUser', () => {
        it('returns only channels user is member of', () => {
            const { store, cache } = createTestCache()
            const ch1 = store.channels.createChannel('ns1', 'shared', 'user-1')
            store.channels.addMember(ch1.id, 'user-1', 'owner')
            store.channels.addMember(ch1.id, 'user-2', 'member')
            const ch2 = store.channels.createChannel('ns1', 'private', 'user-1')
            store.channels.addMember(ch2.id, 'user-1', 'owner')
            cache.reloadAll()

            expect(cache.getChannelsForUser('ns1', 'user-1')).toHaveLength(2)
            expect(cache.getChannelsForUser('ns1', 'user-2')).toHaveLength(1)
            expect(cache.getChannelsForUser('ns1', 'user-3')).toHaveLength(0)
        })

        it('returns membership-matching channels regardless of namespace (Stage 2 cross-namespace)', () => {
            const { store, cache } = createTestCache()
            const ch1 = store.channels.createChannel('ns1', 'ch1', 'user-1')
            store.channels.addMember(ch1.id, 'user-1', 'owner')
            const ch2 = store.channels.createChannel('ns2', 'ch2', 'user-1')
            store.channels.addMember(ch2.id, 'user-1', 'owner')
            cache.reloadAll()

            // Stage 2: visibility is membership-based, not namespace-match.
            // user-1 is a member of both channels, so both lists return both.
            expect(cache.getChannelsForUser('ns1', 'user-1')).toHaveLength(2)
            expect(cache.getChannelsForUser('ns2', 'user-1')).toHaveLength(2)
        })
    })

    describe('isMember', () => {
        it('returns false for non-member', () => {
            const { store, cache } = createTestCache()
            const ch = store.channels.createChannel('ns1', 'test', 'user-1')
            store.channels.addMember(ch.id, 'user-1', 'owner')
            cache.reloadAll()

            expect(cache.isMember(ch.id, 'user-1')).toBe(true)
            expect(cache.isMember(ch.id, 'user-2')).toBe(false)
        })

        it('returns false for non-existent channel', () => {
            const { cache } = createTestCache()
            cache.reloadAll()
            expect(cache.isMember('non-existent', 'user-1')).toBe(false)
        })
    })

    describe('addChannel', () => {
        it('adds to cache and emits channel-added event', () => {
            const { store, cache, events } = createTestCache()
            cache.reloadAll()
            const ch = store.channels.createChannel('ns1', 'new-channel', 'user-1')

            cache.addChannel(ch)

            expect(cache.getChannel(ch.id, 'ns1')).not.toBeNull()
            const addedEvent = events.find((e) => e.type === 'channel-added')
            expect(addedEvent).toBeDefined()
            expect((addedEvent as any).channelId).toBe(ch.id)
        })

        it('initializes empty membership set', () => {
            const { store, cache } = createTestCache()
            cache.reloadAll()
            const ch = store.channels.createChannel('ns1', 'new-channel', 'user-1')

            cache.addChannel(ch)

            expect(cache.isMember(ch.id, 'user-1')).toBe(false)
        })
    })

    describe('updateChannel', () => {
        it('refreshes from store and emits channel-updated event', () => {
            const { store, cache, events } = createTestCache()
            const ch = store.channels.createChannel('ns1', 'test', 'user-1')
            cache.reloadAll()
            events.length = 0

            store.channels.updateChannel(ch.id, 'ns1', { description: 'updated' })
            cache.updateChannel(ch.id, 'ns1')

            const cached = cache.getChannel(ch.id, 'ns1')
            expect(cached?.description).toBe('updated')
            const updatedEvent = events.find((e) => e.type === 'channel-updated')
            expect(updatedEvent).toBeDefined()
        })

        it('removes from cache if channel no longer exists in store', () => {
            const { store, cache } = createTestCache()
            const ch = store.channels.createChannel('ns1', 'test', 'user-1')
            cache.reloadAll()

            store.channels.deleteChannel(ch.id, 'ns1')
            cache.updateChannel(ch.id, 'ns1')

            expect(cache.getChannel(ch.id, 'ns1')).toBeNull()
        })
    })

    describe('removeChannel', () => {
        it('removes from cache and emits channel-removed event', () => {
            const { store, cache, events } = createTestCache()
            const ch = store.channels.createChannel('ns1', 'test', 'user-1')
            store.channels.addMember(ch.id, 'user-1', 'owner')
            cache.reloadAll()
            events.length = 0

            cache.removeChannel(ch.id, 'ns1')

            expect(cache.getChannel(ch.id, 'ns1')).toBeNull()
            expect(cache.isMember(ch.id, 'user-1')).toBe(false)
            const removedEvent = events.find((e) => e.type === 'channel-removed')
            expect(removedEvent).toBeDefined()
        })
    })

    describe('addMember', () => {
        it('updates membership and emits channel-member-added event', () => {
            const { store, cache, events } = createTestCache()
            const ch = store.channels.createChannel('ns1', 'test', 'user-1')
            cache.reloadAll()
            events.length = 0

            cache.addMember(ch.id, 'user-2', 'ns1')

            expect(cache.isMember(ch.id, 'user-2')).toBe(true)
            const addedEvent = events.find((e) => e.type === 'channel-member-added')
            expect(addedEvent).toBeDefined()
            expect((addedEvent as any).userId).toBe('user-2')
        })

        it('creates membership set if channel was not loaded', () => {
            const { cache, events } = createTestCache()
            cache.reloadAll()

            cache.addMember('new-channel', 'user-1', 'ns1')

            expect(cache.isMember('new-channel', 'user-1')).toBe(true)
        })
    })

    describe('removeMember', () => {
        it('updates membership and emits channel-member-removed event', () => {
            const { store, cache, events } = createTestCache()
            const ch = store.channels.createChannel('ns1', 'test', 'user-1')
            store.channels.addMember(ch.id, 'user-1', 'owner')
            store.channels.addMember(ch.id, 'user-2', 'member')
            cache.reloadAll()
            events.length = 0

            cache.removeMember(ch.id, 'user-2', 'ns1')

            expect(cache.isMember(ch.id, 'user-2')).toBe(false)
            expect(cache.isMember(ch.id, 'user-1')).toBe(true)
            const removedEvent = events.find((e) => e.type === 'channel-member-removed')
            expect(removedEvent).toBeDefined()
            expect((removedEvent as any).userId).toBe('user-2')
        })
    })

    describe('getMembers', () => {
        it('delegates to store for full member data', () => {
            const { store, cache } = createTestCache()
            const ch = store.channels.createChannel('ns1', 'test', 'user-1')
            store.channels.addMember(ch.id, 'user-1', 'owner')
            store.channels.addMember(ch.id, 'user-2', 'member')
            cache.reloadAll()

            const members = cache.getMembers(ch.id)
            expect(members).toHaveLength(2)
            expect(members[0].userId).toBe('user-1')
            expect(members[0].role).toBe('owner')
        })
    })
})
