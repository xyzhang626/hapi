import { describe, expect, it, mock, afterEach } from 'bun:test'
import { ChannelAgent } from './channelAgent'
import type { SyncEvent } from '@hapi/protocol/types'

type EngineDouble = {
    subscribe: (cb: (e: SyncEvent) => void) => () => void
    sendMessage: (sid: string, payload: { text: string; sentFrom?: string }) => Promise<void>
    getChannel: (id: string, ns: string) => any
    getSession: (id: string) => any
    sendCalls: Array<{ sid: string; text: string }>
    fire: (e: SyncEvent) => void
}

function makeEngine(): EngineDouble {
    const listeners: Array<(e: SyncEvent) => void> = []
    const sendCalls: Array<{ sid: string; text: string }> = []
    return {
        subscribe(cb) {
            listeners.push(cb)
            return () => { listeners.splice(listeners.indexOf(cb), 1) }
        },
        async sendMessage(sid, payload) {
            sendCalls.push({ sid, text: payload.text })
        },
        getChannel(id, _ns) {
            // Default channel with a bot session
            return {
                id,
                namespace: 'ns1',
                name: 'eng',
                description: null,
                agentConfig: { botName: 'Agent' },
                createdBy: 'user-1',
                createdAt: 0,
                updatedAt: 0,
                nextSeq: 1,
                botSessionId: 'bot-session-1'
            }
        },
        getSession(id) {
            // Default thread session in the channel
            return {
                id,
                namespace: 'ns1',
                channelId: 'channel-1',
                threadTitle: 't',
                threadStatus: 'completed',
                active: false
            }
        },
        sendCalls,
        fire(e) {
            for (const cb of listeners) cb(e)
        }
    }
}

function userMsgEvent(text: string, opts: Partial<{ channelId: string; namespace: string; authorUserId: string; messageId: string; seq: number }> = {}): SyncEvent {
    return {
        type: 'channel-message-received',
        channelId: opts.channelId ?? 'channel-1',
        namespace: opts.namespace ?? 'ns1',
        message: {
            id: opts.messageId ?? 'msg-' + Math.random().toString(36).slice(2),
            channelId: opts.channelId ?? 'channel-1',
            namespace: opts.namespace ?? 'ns1',
            authorUserId: opts.authorUserId ?? 'user-1',
            kind: 'text',
            body: { text },
            threadSessionId: null,
            createdAt: Date.now(),
            seq: opts.seq ?? 1
        }
    } as SyncEvent
}

describe('ChannelAgent (Stage 2 router)', () => {
    let agent: ChannelAgent | null = null
    afterEach(() => {
        agent?.stop()
        agent = null
    })

    it('strong signal: @agent triggers immediate inject to bot session', async () => {
        const engine = makeEngine()
        agent = new ChannelAgent(engine as any)
        engine.fire(userMsgEvent('@agent please implement login'))
        await new Promise((r) => setTimeout(r, 10))
        expect(engine.sendCalls).toHaveLength(1)
        expect(engine.sendCalls[0].sid).toBe('bot-session-1')
        expect(engine.sendCalls[0].text).toContain('<system>mentioned')
        expect(engine.sendCalls[0].text).toContain('please implement login')
    })

    it('strong signal: custom @<botName> alias also triggers', async () => {
        const engine = makeEngine()
        engine.getChannel = (id, _ns) => ({
            id, namespace: 'ns1', name: 'eng', description: null,
            agentConfig: { botName: 'Sherlock' },
            createdBy: 'u', createdAt: 0, updatedAt: 0, nextSeq: 1,
            botSessionId: 'bot-1'
        })
        agent = new ChannelAgent(engine as any)
        engine.fire(userMsgEvent('@Sherlock please look into this'))
        await new Promise((r) => setTimeout(r, 10))
        expect(engine.sendCalls).toHaveLength(1)
        expect(engine.sendCalls[0].text.toLowerCase()).toContain('@sherlock')
    })

    it('weak signal: 2 messages flush immediately as a batch', async () => {
        const engine = makeEngine()
        agent = new ChannelAgent(engine as any)
        engine.fire(userMsgEvent('lol', { messageId: 'm1' }))
        expect(engine.sendCalls).toHaveLength(0) // not yet — only 1 msg
        engine.fire(userMsgEvent('cool', { messageId: 'm2' }))
        await new Promise((r) => setTimeout(r, 10))
        expect(engine.sendCalls).toHaveLength(1)
        expect(engine.sendCalls[0].text).toContain('<system>weak-signal-batch')
        expect(engine.sendCalls[0].text).toContain('lol')
        expect(engine.sendCalls[0].text).toContain('cool')
    })

    it('weak signal: single message flushes after debounce timeout', async () => {
        const engine = makeEngine()
        agent = new ChannelAgent(engine as any)
        engine.fire(userMsgEvent('hello', { messageId: 'm1' }))
        expect(engine.sendCalls).toHaveLength(0)
        await new Promise((r) => setTimeout(r, 3100))
        expect(engine.sendCalls).toHaveLength(1)
        expect(engine.sendCalls[0].text).toContain('hello')
    }, 5000)

    it('bot self-messages do NOT feed back', async () => {
        const engine = makeEngine()
        agent = new ChannelAgent(engine as any)
        const botMsg: SyncEvent = {
            type: 'channel-message-received',
            channelId: 'channel-1',
            namespace: 'ns1',
            message: {
                id: 'm1', channelId: 'channel-1', namespace: 'ns1',
                authorUserId: null, kind: 'text',
                body: { text: 'hi from bot', fromBot: true, fromSession: 'bot-session-1' },
                threadSessionId: 'bot-session-1',
                createdAt: Date.now(), seq: 1
            }
        } as SyncEvent
        engine.fire(botMsg)
        await new Promise((r) => setTimeout(r, 10))
        expect(engine.sendCalls).toHaveLength(0)
    })

    it('strong signal flushes pending weak buffer first to preserve order', async () => {
        const engine = makeEngine()
        agent = new ChannelAgent(engine as any)
        engine.fire(userMsgEvent('hmm', { messageId: 'm1' }))
        engine.fire(userMsgEvent('@agent help', { messageId: 'm2' }))
        await new Promise((r) => setTimeout(r, 10))
        // First call should be the weak buffer flush, second the strong signal
        expect(engine.sendCalls.length).toBeGreaterThanOrEqual(2)
        expect(engine.sendCalls[0].text).toContain('weak-signal-batch')
        const lastCall = engine.sendCalls[engine.sendCalls.length - 1]
        expect(lastCall.text).toContain('mentioned')
        expect(lastCall.text).toContain('help')
    })

    it('thread state change: session-updated with active=false fires strong signal', async () => {
        const engine = makeEngine()
        agent = new ChannelAgent(engine as any)
        const event: SyncEvent = {
            type: 'session-updated',
            sessionId: 'thread-session-1',
            namespace: 'ns1'
        } as SyncEvent
        engine.fire(event)
        await new Promise((r) => setTimeout(r, 10))
        expect(engine.sendCalls).toHaveLength(1)
        expect(engine.sendCalls[0].sid).toBe('bot-session-1')
        expect(engine.sendCalls[0].text).toContain('thread-completed')
        expect(engine.sendCalls[0].text).toContain('thread-session-1')
    })

    it('skips channels with no bot session', async () => {
        const engine = makeEngine()
        engine.getChannel = () => ({
            id: 'channel-1', namespace: 'ns1', name: 'eng',
            description: null, agentConfig: null,
            createdBy: 'u', createdAt: 0, updatedAt: 0, nextSeq: 1,
            botSessionId: null
        })
        agent = new ChannelAgent(engine as any)
        engine.fire(userMsgEvent('@agent help'))
        await new Promise((r) => setTimeout(r, 10))
        expect(engine.sendCalls).toHaveLength(0)
    })

    it('thread-completed event for the bot session itself is ignored (just invalidates cache)', async () => {
        const engine = makeEngine()
        engine.getSession = (id) => {
            if (id === 'bot-session-1') {
                return { id, namespace: 'ns1', channelId: 'channel-1', threadTitle: null, threadStatus: null, active: false }
            }
            return null
        }
        agent = new ChannelAgent(engine as any)
        engine.fire({ type: 'session-updated', sessionId: 'bot-session-1', namespace: 'ns1' } as SyncEvent)
        await new Promise((r) => setTimeout(r, 10))
        expect(engine.sendCalls).toHaveLength(0)
    })
})
