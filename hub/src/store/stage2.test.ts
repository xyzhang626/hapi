import { describe, expect, it } from 'bun:test'
import { Store } from './index'

function setup() {
    const store = new Store(':memory:')
    const channel = store.channels.createChannel('ns1', 'general', 'user-1')
    const message = store.channelMessages.addMessage(channel.id, 'ns1', 'user-1', 'text', { text: 'hello' })
    return { store, channel, message }
}

describe('ChannelMessageReactionStore', () => {
    it('adds a reaction and retrieves it', () => {
        const { store, message } = setup()
        const reaction = store.channelMessageReactions.add(message.id, 'user:user-1', '👀')
        expect(reaction.messageId).toBe(message.id)
        expect(reaction.reactorRef).toBe('user:user-1')
        expect(reaction.emoji).toBe('👀')
        expect(reaction.createdAt).toBeGreaterThan(0)

        const list = store.channelMessageReactions.getForMessage(message.id)
        expect(list).toHaveLength(1)
        expect(list[0].emoji).toBe('👀')
    })

    it('idempotent add is safe (composite PK)', () => {
        const { store, message } = setup()
        store.channelMessageReactions.add(message.id, 'user:user-1', '👀')
        store.channelMessageReactions.add(message.id, 'user:user-1', '👀')
        expect(store.channelMessageReactions.getForMessage(message.id)).toHaveLength(1)
    })

    it('different emojis from same reactor coexist', () => {
        const { store, message } = setup()
        store.channelMessageReactions.add(message.id, 'user:user-1', '👀')
        store.channelMessageReactions.add(message.id, 'user:user-1', '🙏')
        expect(store.channelMessageReactions.getForMessage(message.id)).toHaveLength(2)
    })

    it('different reactors coexist on same emoji', () => {
        const { store, message } = setup()
        store.channelMessageReactions.add(message.id, 'user:alice', '👀')
        store.channelMessageReactions.add(message.id, 'user:bob', '👀')
        store.channelMessageReactions.add(message.id, 'bot:bot-session-1', '👀')
        expect(store.channelMessageReactions.getForMessage(message.id)).toHaveLength(3)
    })

    it('toggle adds when missing and removes when present', () => {
        const { store, message } = setup()
        const r1 = store.channelMessageReactions.toggle(message.id, 'user:alice', '🙏')
        expect(r1.result).toBe('added')
        expect(store.channelMessageReactions.getForMessage(message.id)).toHaveLength(1)

        const r2 = store.channelMessageReactions.toggle(message.id, 'user:alice', '🙏')
        expect(r2.result).toBe('removed')
        expect(store.channelMessageReactions.getForMessage(message.id)).toHaveLength(0)
    })

    it('remove returns false when reaction not present', () => {
        const { store, message } = setup()
        expect(store.channelMessageReactions.remove(message.id, 'user:alice', '🙏')).toBe(false)
    })

    it('cascade-deletes on channel deletion (FK ON DELETE CASCADE)', () => {
        const { store, channel, message } = setup()
        store.channelMessageReactions.add(message.id, 'user:alice', '👀')
        expect(store.channelMessageReactions.getForMessage(message.id)).toHaveLength(1)
        store.channels.deleteChannel(channel.id, 'ns1')
        expect(store.channelMessageReactions.getForMessage(message.id)).toHaveLength(0)
    })

    it('getForMessages returns reactions grouped by messageId', () => {
        const store = new Store(':memory:')
        const channel = store.channels.createChannel('ns1', 'general', 'user-1')
        const m1 = store.channelMessages.addMessage(channel.id, 'ns1', 'user-1', 'text', { text: 'a' })
        const m2 = store.channelMessages.addMessage(channel.id, 'ns1', 'user-1', 'text', { text: 'b' })
        store.channelMessageReactions.add(m1.id, 'user:alice', '👀')
        store.channelMessageReactions.add(m1.id, 'user:bob', '🙏')
        store.channelMessageReactions.add(m2.id, 'user:alice', '✅')

        const grouped = store.channelMessageReactions.getForMessages([m1.id, m2.id])
        expect(grouped.get(m1.id)).toHaveLength(2)
        expect(grouped.get(m2.id)).toHaveLength(1)
    })
})

describe('Stage 2 schema additions', () => {
    it('sessions default to non-bot, non-scheduled, private', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('tag1', { foo: 'bar' }, null, 'ns1')
        expect(session.isChannelBot).toBe(false)
        expect(session.scheduled).toBe(false)
        expect(session.schedule).toBeNull()
        expect(session.pinned).toBe(false)
        expect(session.visibility).toBe('private')
    })

    it('channel bot session can be created with channelOpts', () => {
        const store = new Store(':memory:')
        const channel = store.channels.createChannel('ns1', 'eng', 'user-1')
        const session = store.sessions.getOrCreateSession('bot-tag', { isBot: true }, null, 'ns1', undefined, undefined, undefined, {
            channelId: channel.id,
            isChannelBot: true,
            visibility: 'private'
        })
        expect(session.isChannelBot).toBe(true)
        expect(session.channelId).toBe(channel.id)
    })

    it('scheduled thread session has correct fields', () => {
        const store = new Store(':memory:')
        const channel = store.channels.createChannel('ns1', 'eng', 'user-1')
        const session = store.sessions.getOrCreateSession('sched-tag', {}, null, 'ns1', undefined, undefined, undefined, {
            channelId: channel.id,
            threadTitle: 'Watch deploy',
            createdByUserId: 'user-1',
            scheduled: true,
            schedule: '*/15 * * * *',
            pinned: true,
            visibility: 'shared'
        })
        expect(session.scheduled).toBe(true)
        expect(session.schedule).toBe('*/15 * * * *')
        expect(session.pinned).toBe(true)
        expect(session.visibility).toBe('shared')
    })

    it('setSessionPinned and setThreadVisibility work', () => {
        const store = new Store(':memory:')
        const channel = store.channels.createChannel('ns1', 'eng', 'user-1')
        const s = store.sessions.getOrCreateSession('t', {}, null, 'ns1', undefined, undefined, undefined, { channelId: channel.id })
        expect(s.pinned).toBe(false)
        expect(store.sessions.setSessionPinned(s.id, 'ns1', true)).toBe(true)
        expect(store.sessions.getSession(s.id)!.pinned).toBe(true)
        expect(store.sessions.setThreadVisibility(s.id, 'ns1', 'shared')).toBe(true)
        expect(store.sessions.getSession(s.id)!.visibility).toBe('shared')
    })

    it('getChannelBotSessionId finds the bot session for a channel', () => {
        const store = new Store(':memory:')
        const channel = store.channels.createChannel('ns1', 'eng', 'user-1')
        // create regular thread session first
        store.sessions.getOrCreateSession('thread', {}, null, 'ns1', undefined, undefined, undefined, {
            channelId: channel.id,
            threadTitle: 't1',
            createdByUserId: 'user-1'
        })
        // then bot session
        const bot = store.sessions.getOrCreateSession('bot', {}, null, 'ns1', undefined, undefined, undefined, {
            channelId: channel.id,
            isChannelBot: true
        })
        const found = store.sessions.getChannelBotSessionId(channel.id, 'ns1')
        expect(found).toBe(bot.id)
    })

    it('channel.botSessionId getter and setter work', () => {
        const store = new Store(':memory:')
        const channel = store.channels.createChannel('ns1', 'eng', 'user-1')
        expect(channel.botSessionId).toBeNull()
        const bot = store.sessions.getOrCreateSession('bot', {}, null, 'ns1', undefined, undefined, undefined, {
            channelId: channel.id,
            isChannelBot: true
        })
        expect(store.channels.setBotSessionId(channel.id, 'ns1', bot.id)).toBe(true)
        expect(store.channels.getChannel(channel.id, 'ns1')!.botSessionId).toBe(bot.id)
    })

    it('getAllChannelBotSessions returns bot sessions across channels', () => {
        const store = new Store(':memory:')
        const c1 = store.channels.createChannel('ns1', 'a', 'user-1')
        const c2 = store.channels.createChannel('ns1', 'b', 'user-1')
        store.sessions.getOrCreateSession('bot1', {}, null, 'ns1', undefined, undefined, undefined, {
            channelId: c1.id, isChannelBot: true
        })
        store.sessions.getOrCreateSession('bot2', {}, null, 'ns1', undefined, undefined, undefined, {
            channelId: c2.id, isChannelBot: true
        })
        store.sessions.getOrCreateSession('not-bot', {}, null, 'ns1', undefined, undefined, undefined, {
            channelId: c1.id, threadTitle: 't', createdByUserId: 'user-1'
        })
        expect(store.sessions.getAllChannelBotSessions()).toHaveLength(2)
    })
})
