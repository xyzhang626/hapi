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

/**
 * Strong-signal injections wrap user-controlled text inside a
 * `<system>...</system>` tag whose closing literal is what the bot
 * scans for. If a user puts a literal `</system>` (or `<system>`) in
 * their message body, an unsanitized inject would let them spoof a
 * fake strong-signal envelope visible to the bot. Strip those
 * substrings everywhere user content lands inside the wrap.
 *
 * Newlines are normalized too — they're harmless to the bot but make
 * the log noisier and risk turning a single-line payload into a
 * multi-line one that visually bleeds into the next inject.
 */
function sanitizeForSystemTag(s: string): string {
    return s
        .replace(/<\/?system>/gi, '[tag]')
        .replace(/\r?\n/g, ' ')
}

/**
 * Stage 2: when a thread session goes from active → !active but its
 * threadStatus is still 'active' (i.e., not explicitly completed or
 * archived), wait this long before treating it as a "stall" worth
 * notifying the bot about. If the session bounces back active within
 * this window, the pending signal is canceled so we don't spam the
 * bot with churn from short-lived disconnects.
 */
const THREAD_STALL_DEBOUNCE_MS = 10_000

type WeakBuffer = {
    pending: Array<{ authorUserId: string | null; text: string; messageId: string; seq: number; createdAt: number }>
    timer: ReturnType<typeof setTimeout> | null
}

type ChannelContext = {
    botSessionId: string
    botName: string
}

type ThreadFiredState = 'completed' | 'archived' | 'stalled'

export class ChannelAgent {
    private readonly weakBuffers: Map<string, WeakBuffer> = new Map()
    private readonly channelContextCache: Map<string, ChannelContext> = new Map()
    /** Last strong signal we forwarded for a thread, keyed by sessionId.
     *  Prevents duplicate `thread-completed` etc. emissions when the
     *  session-updated event repeats. */
    private readonly threadLastFiredState: Map<string, ThreadFiredState> = new Map()
    /** Pending stall timers keyed by sessionId. Cleared when the
     *  session comes back active or when the timer fires. */
    private readonly threadStallTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
    /**
     * Stage 2: per-channel "who triggered the most recent strong signal".
     * The bot's `spawn_thread` MCP tool doesn't carry the requesting user's
     * id (the bot doesn't know it), so we shadow-track it here. `botSpawnThread`
     * reads this when stamping `createdByUserId` on the new thread row, so
     * "Share to channel" / "by Alice" attribute the right person rather than
     * the bot session id.
     */
    private readonly lastTriggeringUserId: Map<string, { userId: string; at: number }> = new Map()
    private unsubscribe: (() => void) | null = null

    constructor(private readonly engine: SyncEngine) {
        this.unsubscribe = engine.subscribe((event) => this.handleEvent(event))
    }

    /** Last user who fired a strong signal in this channel, if it was within
     *  the freshness window (default 5 minutes). Used by botSpawnThread to
     *  attribute new threads to the requester instead of the bot session. */
    public lookupRecentTriggeringUser(channelId: string, withinMs = 5 * 60 * 1000): string | null {
        const entry = this.lastTriggeringUserId.get(channelId)
        if (!entry) return null
        if (Date.now() - entry.at > withinMs) return null
        return entry.userId
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
        for (const t of this.threadStallTimers.values()) {
            clearTimeout(t)
        }
        this.threadStallTimers.clear()
        this.threadLastFiredState.clear()
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
        // Stage 2: same trigger-attribution path as forwardStrongSignal —
        // remember who asked so the spawned thread is credited to the user.
        if (event.userId) {
            this.lastTriggeringUserId.set(event.channelId, { userId: event.userId, at: Date.now() })
        }
        const safeTopic = sanitizeForSystemTag(event.topic).slice(0, 500)
        const wrapped = `<system>user-requested-new-thread: { userId: "${event.userId}", topic: ${JSON.stringify(safeTopic)} }</system>\n${safeTopic}`
        void this.engine.sendMessage(ctx.botSessionId, { text: wrapped, sentFrom: 'webapp' }).catch((err) => {
            console.error('[ChannelAgent] forward thread-requested failed:', err)
        })
    }

    /** Look up bot session id + name for a channel.
     *  Cached only when a bot exists; misses are re-queried each call so
     *  a bot that respawns a few seconds after the lookup is picked up
     *  on the next event without waiting for the bot's own session-updated
     *  to invalidate the cache. */
    private getChannelContext(channelId: string, namespace: string): ChannelContext | null {
        const cached = this.channelContextCache.get(channelId)
        if (cached !== undefined) return cached
        const channel = this.engine.getChannel(channelId, namespace)
        if (!channel || !channel.botSessionId) {
            // Don't cache misses — let a future call re-query so a
            // late-spawned bot gets picked up promptly.
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

        // Stage-2 item #6: distinguish thread state changes by threadStatus,
        // dedupe repeats, and debounce active=false flapping.
        //
        // - threadStatus 'completed' / 'archived' → fire the matching strong
        //   signal immediately (these are explicit terminal transitions).
        // - active=false but threadStatus still 'active' → debounce 10s. If
        //   the session comes back active within the window, cancel; otherwise
        //   fire 'thread-stalled' so the bot can decide whether to nudge.
        // - active=true → cancel any pending stall timer and clear last-fired
        //   memo so a future genuine completion can fire again.
        if (session.threadStatus === 'completed') {
            this.fireThreadStateSignal(session.channelId, namespace, ctx, 'completed', sessionId, session.threadTitle ?? '', session.threadStatus)
            return
        }
        if (session.threadStatus === 'archived') {
            this.fireThreadStateSignal(session.channelId, namespace, ctx, 'archived', sessionId, session.threadTitle ?? '', session.threadStatus)
            return
        }

        if (session.active) {
            // Came back online — cancel pending stall and forget last-fired
            // (so a future stall would fire again).
            const t = this.threadStallTimers.get(sessionId)
            if (t) {
                clearTimeout(t)
                this.threadStallTimers.delete(sessionId)
            }
            this.threadLastFiredState.delete(sessionId)
            return
        }

        // active=false, threadStatus still 'active' → schedule a stall signal
        // unless one is already pending or already fired.
        if (this.threadStallTimers.has(sessionId)) return
        if (this.threadLastFiredState.get(sessionId) === 'stalled') return
        const channelId = session.channelId
        const threadTitle = session.threadTitle ?? ''
        const timer = setTimeout(() => {
            this.threadStallTimers.delete(sessionId)
            const fresh = this.engine.getSession(sessionId)
            if (!fresh) return
            // Fire only if still inactive AND still in active threadStatus
            // (i.e., a terminal status didn't preempt us in the meantime).
            if (fresh.active) return
            if (fresh.threadStatus !== 'active' && fresh.threadStatus !== undefined) return
            const freshCtx = this.getChannelContext(channelId, fresh.namespace)
            if (!freshCtx) return
            this.fireThreadStateSignal(channelId, fresh.namespace, freshCtx, 'stalled', sessionId, fresh.threadTitle ?? threadTitle, fresh.threadStatus ?? 'active')
        }, THREAD_STALL_DEBOUNCE_MS)
        this.threadStallTimers.set(sessionId, timer)
    }

    private fireThreadStateSignal(
        channelId: string,
        namespace: string,
        ctx: ChannelContext,
        kind: ThreadFiredState,
        sessionId: string,
        threadTitle: string,
        threadStatus: string
    ): void {
        // Dedup: don't re-fire the same kind for the same session.
        if (this.threadLastFiredState.get(sessionId) === kind) return
        this.threadLastFiredState.set(sessionId, kind)

        this.flushWeakBuffer(channelId, namespace, ctx)
        const tag = `thread-${kind}`
        const safeTitle = sanitizeForSystemTag(threadTitle)
        const summary = `<system>${tag}: { threadId: "${sessionId}", title: ${JSON.stringify(safeTitle)}, status: "${threadStatus}" }</system>`
        void this.engine.sendMessage(ctx.botSessionId, { text: summary, sentFrom: 'webapp' }).catch((err) => {
            console.error('[ChannelAgent] forward thread state failed:', err)
        })
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
        const safeText = sanitizeForSystemTag(text)
        const wrapped = `<system>${tag}: { authorUserId: "${message.authorUserId ?? 'unknown'}", messageId: "${message.id}" }</system>\n${safeText}`
        // Stage 2: stash who triggered this strong signal so botSpawnThread
        // can credit them as the thread's createdByUserId — the bot doesn't
        // pass userId via MCP and we'd otherwise stamp the bot session id.
        if (message.authorUserId) {
            this.lastTriggeringUserId.set(channelId, { userId: message.authorUserId, at: Date.now() })
        }
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
            return `[${it.authorUserId ?? 'anon'} | msgId=${it.messageId}] ${sanitizeForSystemTag(it.text)}`
        }).join('\n')
        const wrapped = `<system>weak-signal-batch: { count: ${items.length} }</system>\n${lines}`

        void this.engine.sendMessage(ctx.botSessionId, { text: wrapped, sentFrom: 'webapp' }).catch((err) => {
            console.error('[ChannelAgent] flush weak buffer failed:', err)
        })
    }
}
