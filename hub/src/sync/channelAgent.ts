import type { SyncEvent } from '@hapi/protocol/types'
import type { SyncEngine } from './syncEngine'

/**
 * Stage 2 ChannelAgent — pure message router.
 *
 * Responsibilities (only):
 *   1. Detect strong signals (@mention, thread state changes,
 *      channel-thread-requested) and immediately inject them into the
 *      channel's bot session as user messages tagged <system>...</system>.
 *   2. Debounce weak signals (other real-user messages) per-channel
 *      and flush them as a batched user message either when 2 messages
 *      have accumulated OR after 3s of idle.
 *
 * Things this no longer does (moved to bot via MCP):
 *   - Spawn threads on @mention
 *   - Generate thread_card / agent_summary messages
 *   - Maintain a task queue with MAX_ACTIVE limits
 *
 * Bot's own channel-bot:send-message outputs do NOT feed back into the
 * bot session (avoid self-excitation). We detect this by message body
 * having `fromBot: true` or `fromSession === botSessionId`.
 */

const WEAK_SIGNAL_DEBOUNCE_MS = 3_000
const WEAK_SIGNAL_FLUSH_THRESHOLD = 2

type WeakBuffer = {
    pending: Array<{ authorUserId: string | null; text: string; messageId: string; seq: number; createdAt: number }>
    timer: ReturnType<typeof setTimeout> | null
}

type ChannelContext = {
    botSessionId: string
    botName: string
}

export class ChannelAgent {
    private readonly weakBuffers: Map<string, WeakBuffer> = new Map()
    private readonly channelContextCache: Map<string, ChannelContext | null> = new Map()
    private unsubscribe: (() => void) | null = null

    constructor(private readonly engine: SyncEngine) {
        this.unsubscribe = engine.subscribe((event) => this.handleEvent(event))
    }

    stop(): void {
        if (this.unsubscribe) {
            this.unsubscribe()
            this.unsubscribe = null
        }
        for (const buf of this.weakBuffers.values()) {
            if (buf.timer) clearTimeout(buf.timer)
        }
        this.weakBuffers.clear()
        this.channelContextCache.clear()
    }

    private handleEvent(event: SyncEvent): void {
        if (event.type === 'channel-message-received') {
            this.handleChannelMessage(event)
        } else if (event.type === 'session-updated') {
            this.handleSessionUpdate(event)
        } else if (event.type === 'channel-thread-requested') {
            this.handleThreadRequested(event)
        }
    }

    private handleThreadRequested(event: Extract<SyncEvent, { type: 'channel-thread-requested' }>): void {
        const namespace = event.namespace ?? ''
        if (!namespace) return
        const ctx = this.getChannelContext(event.channelId, namespace)
        if (!ctx) return
        // Flush pending weak buffer first to preserve ordering before this
        // strong signal lands in the bot session.
        this.flushWeakBuffer(event.channelId, namespace, ctx)
        const safeTopic = event.topic.replace(/\n/g, ' ').slice(0, 500)
        const wrapped = `<system>user-requested-new-thread: { userId: "${event.userId}", topic: ${JSON.stringify(safeTopic)} }</system>\n${safeTopic}`
        void this.engine.sendMessage(ctx.botSessionId, { text: wrapped, sentFrom: 'webapp' }).catch((err) => {
            console.error('[ChannelAgent] forward thread-requested failed:', err)
        })
    }

    /** Look up bot session id + name for a channel; cached. */
    private getChannelContext(channelId: string, namespace: string): ChannelContext | null {
        if (this.channelContextCache.has(channelId)) {
            return this.channelContextCache.get(channelId) ?? null
        }
        const channel = this.engine.getChannel(channelId, namespace)
        if (!channel || !channel.botSessionId) {
            this.channelContextCache.set(channelId, null)
            return null
        }
        const cfg = channel.agentConfig as { botName?: string } | null
        const ctx: ChannelContext = {
            botSessionId: channel.botSessionId,
            botName: cfg?.botName ?? 'Agent'
        }
        this.channelContextCache.set(channelId, ctx)
        return ctx
    }

    /** Invalidate context cache (e.g., after bot restart with new sessionId). */
    private invalidateChannelContext(channelId: string): void {
        this.channelContextCache.delete(channelId)
    }

    private handleChannelMessage(event: Extract<SyncEvent, { type: 'channel-message-received' }>): void {
        const message = event.message
        const namespace = event.namespace ?? ''
        if (!namespace) return

        const ctx = this.getChannelContext(event.channelId, namespace)
        if (!ctx) return // No bot for this channel

        // Skip messages emitted by the bot itself (avoid self-excitation)
        const body = message.body
        if (typeof body === 'object' && body !== null) {
            const b = body as { fromBot?: boolean; fromSession?: string }
            if (b.fromBot === true || b.fromSession === ctx.botSessionId) {
                return
            }
        }

        // Skip system-injected messages (those have authorUserId=null and are
        // typically thread_card / agent_summary). Only real human text should
        // be forwarded.
        if (message.authorUserId === null) {
            return
        }
        if (message.kind !== 'text') {
            return
        }

        const text = this.extractText(body)
        if (!text) return

        // Strong signal: @mention of bot
        if (this.isStrongMentionSignal(text, ctx.botName)) {
            this.flushWeakBuffer(event.channelId, namespace, ctx) // flush pending weak first to preserve order
            this.forwardStrongSignal(event.channelId, namespace, ctx, 'mentioned', message, text)
            return
        }

        // Otherwise — weak signal: enqueue for debounced flush
        this.enqueueWeakSignal(event.channelId, namespace, ctx, message, text)
    }

    private handleSessionUpdate(event: Extract<SyncEvent, { type: 'session-updated' }>): void {
        const sessionId = event.sessionId
        const session = this.engine.getSession(sessionId)
        if (!session?.channelId) return
        const namespace = session.namespace
        const ctx = this.getChannelContext(session.channelId, namespace)
        if (!ctx) return

        // Skip the bot session's own state changes
        if (sessionId === ctx.botSessionId) {
            // But: if the bot session has just become inactive (likely a restart),
            // invalidate the context cache so the next bot session id is picked up.
            if (!session.active) {
                this.invalidateChannelContext(session.channelId)
            }
            return
        }

        // Strong signal: thread session state change (active → inactive = completion or stall)
        // We flag it whenever active flips. The bot decides what to do.
        // To avoid spamming, only fire when active=false (completion-ish) for now.
        if (!session.active) {
            this.flushWeakBuffer(session.channelId, namespace, ctx)
            const tag = `thread-completed`
            const summary = `<system>${tag}: { threadId: "${sessionId}", title: "${session.threadTitle ?? ''}", status: "${session.threadStatus ?? 'completed'}" }</system>`
            void this.engine.sendMessage(ctx.botSessionId, { text: summary, sentFrom: 'webapp' }).catch((err) => {
                console.error('[ChannelAgent] forward thread state failed:', err)
            })
        }
    }

    private isStrongMentionSignal(text: string, botName: string): boolean {
        const lower = text.toLowerCase()
        if (lower.includes('@agent') || lower.includes('@claude') || lower.includes('@bot')) return true
        if (botName) {
            const aliasLower = `@${botName.toLowerCase()}`
            if (lower.includes(aliasLower)) return true
        }
        return false
    }

    private extractText(body: unknown): string {
        if (typeof body === 'string') return body
        if (typeof body === 'object' && body !== null) {
            const b = body as { text?: string }
            if (typeof b.text === 'string') return b.text
            try {
                return JSON.stringify(body)
            } catch {
                return ''
            }
        }
        return String(body ?? '')
    }

    private forwardStrongSignal(
        channelId: string,
        namespace: string,
        ctx: ChannelContext,
        tag: string,
        message: { id: string; authorUserId: string | null; createdAt: number },
        text: string
    ): void {
        const wrapped = `<system>${tag}: { authorUserId: "${message.authorUserId ?? 'unknown'}", messageId: "${message.id}" }</system>\n${text}`
        void this.engine.sendMessage(ctx.botSessionId, { text: wrapped, sentFrom: 'webapp' }).catch((err) => {
            console.error('[ChannelAgent] forward strong signal failed:', err)
        })
    }

    private enqueueWeakSignal(
        channelId: string,
        namespace: string,
        ctx: ChannelContext,
        message: { id: string; authorUserId: string | null; seq: number; createdAt: number },
        text: string
    ): void {
        let buf = this.weakBuffers.get(channelId)
        if (!buf) {
            buf = { pending: [], timer: null }
            this.weakBuffers.set(channelId, buf)
        }

        buf.pending.push({
            authorUserId: message.authorUserId,
            text,
            messageId: message.id,
            seq: message.seq,
            createdAt: message.createdAt
        })

        // Reset the idle timer
        if (buf.timer) clearTimeout(buf.timer)

        if (buf.pending.length >= WEAK_SIGNAL_FLUSH_THRESHOLD) {
            this.flushWeakBuffer(channelId, namespace, ctx)
        } else {
            buf.timer = setTimeout(() => {
                this.flushWeakBuffer(channelId, namespace, ctx)
            }, WEAK_SIGNAL_DEBOUNCE_MS)
        }
    }

    private flushWeakBuffer(channelId: string, namespace: string, ctx: ChannelContext): void {
        const buf = this.weakBuffers.get(channelId)
        if (!buf || buf.pending.length === 0) return
        if (buf.timer) {
            clearTimeout(buf.timer)
            buf.timer = null
        }
        const items = buf.pending
        buf.pending = []

        const lines = items.map((it) => {
            return `[${it.authorUserId ?? 'anon'} | msgId=${it.messageId}] ${it.text}`
        }).join('\n')
        const wrapped = `<system>weak-signal-batch: { count: ${items.length} }</system>\n${lines}`

        void this.engine.sendMessage(ctx.botSessionId, { text: wrapped, sentFrom: 'webapp' }).catch((err) => {
            console.error('[ChannelAgent] flush weak buffer failed:', err)
        })
    }
}
