import type { CliSocketWithData } from '../../socketTypes'
import type { Store } from '../../../store'
import type { SyncEngine } from '../../../sync/syncEngine'

/**
 * Channel-bot RPC handlers (Stage 2).
 *
 * The channel bot session — and any thread session attached to a channel —
 * uses MCP tools that round-trip through these socket events back to the hub.
 * Each handler:
 *   1. Validates the caller has a session in the namespace
 *   2. Resolves the session's channelId from metadata
 *   3. Delegates to engine / store
 *   4. Replies with { ok: true, data } or { ok: false, error }
 *
 * Principle: no fallbacks. Errors propagate as { ok: false, error: msg }.
 */

type RpcAck<T = unknown> = (response: { ok: true; data: T } | { ok: false; error: string }) => void

export type ChannelBotHandlersDeps = {
    store: Store
    getSyncEngine: () => SyncEngine | null
}

export function registerChannelBotHandlers(socket: CliSocketWithData, deps: ChannelBotHandlersDeps): void {
    const { store, getSyncEngine } = deps
    const namespace = typeof socket.data.namespace === 'string' ? socket.data.namespace : null
    // Channel-bot RPC events use generic ack typing that doesn't fit Socket.IO's
    // strict ClientToServerEvents map. Cast once and use loose ack types below.
    const sock = socket as unknown as {
        on: (event: string, cb: (...args: any[]) => void) => void
    }

    /** Resolve the bot/thread session + the *channel's* namespace.
     *
     * Stage 2: bot and thread sessions live in the channel's namespace, but
     * the runner that hosts them auths with its own namespace (often
     * 'default' for the embedded runner). So we look up the session
     * cross-namespace by id, then derive the actual channel namespace from
     * the channel row — never from the socket — so the engine operations
     * below find the right channel.
     */
    function resolveChannelContext(sid: string): { ok: true; channelId: string; namespace: string; isBot: boolean } | { ok: false; error: string } {
        if (!namespace) return { ok: false, error: 'No namespace on socket' }
        const session = store.sessions.getSession(sid)
        if (!session) return { ok: false, error: `Session ${sid} not found` }
        if (!session.channelId) return { ok: false, error: `Session ${sid} is not associated with a channel` }
        // Use channel's actual namespace, not the socket's. The session row
        // already lives in channel.namespace after the cli.ts remap, but
        // re-deriving here keeps the handlers robust if that invariant ever
        // drifts.
        const channel = store.channels.getChannelById(session.channelId)
        if (!channel) return { ok: false, error: `Channel ${session.channelId} not found` }
        return { ok: true, channelId: channel.id, namespace: channel.namespace, isBot: session.isChannelBot }
    }

    function ensureBotOnly(sid: string): { ok: true; channelId: string; namespace: string } | { ok: false; error: string } {
        const ctx = resolveChannelContext(sid)
        if (!ctx.ok) return ctx
        if (!ctx.isBot) return { ok: false, error: 'This tool requires a channel-bot session' }
        return { ok: true, channelId: ctx.channelId, namespace: ctx.namespace }
    }

    function reactorRefForCaller(sid: string, isBot: boolean): string {
        return isBot ? `bot:${sid}` : `session:${sid}`
    }

    // ─── send_to_channel ──────────────────────────────────────────────
    sock.on('channel-bot:send-message', async (payload: { sid: string; text: string }, ack: RpcAck) => {
        try {
            const ctx = resolveChannelContext(payload.sid)
            if (!ctx.ok) return ack({ ok: false, error: ctx.error })
            const engine = getSyncEngine()
            if (!engine) return ack({ ok: false, error: 'SyncEngine unavailable' })
            // Stage 2: include botName so the web UI renders "Lumi" instead of
            // a generic "Agent". The body is opaque JSON to the store; this
            // just stamps a hint the UI can consult.
            let botName: string | null = null
            if (ctx.isBot) {
                const channel = store.channels.getChannelById(ctx.channelId)
                const cfg = (channel?.agentConfig ?? null) as { botName?: string } | null
                botName = cfg?.botName ?? 'Agent'
            }
            const message = engine.sendChannelMessage(
                ctx.channelId,
                ctx.namespace,
                null,
                'text',
                { text: payload.text, fromSession: payload.sid, fromBot: ctx.isBot, botName },
                payload.sid
            )
            ack({ ok: true, data: { messageId: message.id, seq: message.seq } })
        } catch (e) {
            ack({ ok: false, error: e instanceof Error ? e.message : String(e) })
        }
    })

    // ─── react_to_message ─────────────────────────────────────────────
    sock.on('channel-bot:react-to-message', async (payload: { sid: string; messageId: string; emoji: string }, ack: RpcAck) => {
        try {
            const ctx = resolveChannelContext(payload.sid)
            if (!ctx.ok) return ack({ ok: false, error: ctx.error })
            const engine = getSyncEngine()
            if (!engine) return ack({ ok: false, error: 'SyncEngine unavailable' })
            const reactorRef = reactorRefForCaller(payload.sid, ctx.isBot)
            const result = engine.toggleMessageReaction(payload.messageId, ctx.channelId, ctx.namespace, reactorRef, payload.emoji)
            ack({ ok: true, data: { result: result.result } })
        } catch (e) {
            ack({ ok: false, error: e instanceof Error ? e.message : String(e) })
        }
    })

    // ─── spawn_thread (bot only) ──────────────────────────────────────
    sock.on('channel-bot:spawn-thread', async (payload: { sid: string; title: string; prompt: string; flavor?: string; model?: string }, ack: RpcAck) => {
        try {
            const ctx = ensureBotOnly(payload.sid)
            if (!ctx.ok) return ack({ ok: false, error: ctx.error })
            const engine = getSyncEngine()
            if (!engine) return ack({ ok: false, error: 'SyncEngine unavailable' })
            const result = await engine.botSpawnThread(ctx.channelId, ctx.namespace, payload.sid, {
                title: payload.title,
                prompt: payload.prompt,
                flavor: (payload.flavor as any) ?? 'claude',
                model: payload.model
            })
            if (result.type === 'error') return ack({ ok: false, error: result.message })
            ack({ ok: true, data: { threadSessionId: result.sessionId } })
        } catch (e) {
            ack({ ok: false, error: e instanceof Error ? e.message : String(e) })
        }
    })

    // ─── spawn_scheduled_thread (bot only) ────────────────────────────
    sock.on('channel-bot:spawn-scheduled-thread', async (payload: { sid: string; title: string; prompt: string; schedule: string; flavor?: string; model?: string }, ack: RpcAck) => {
        try {
            const ctx = ensureBotOnly(payload.sid)
            if (!ctx.ok) return ack({ ok: false, error: ctx.error })
            const engine = getSyncEngine()
            if (!engine) return ack({ ok: false, error: 'SyncEngine unavailable' })
            const result = await engine.botSpawnScheduledThread(ctx.channelId, ctx.namespace, payload.sid, {
                title: payload.title,
                prompt: payload.prompt,
                schedule: payload.schedule,
                flavor: (payload.flavor as any) ?? 'claude',
                model: payload.model
            })
            if (result.type === 'error') return ack({ ok: false, error: result.message })
            ack({ ok: true, data: { threadSessionId: result.sessionId } })
        } catch (e) {
            ack({ ok: false, error: e instanceof Error ? e.message : String(e) })
        }
    })

    // ─── cancel_thread (bot only) ─────────────────────────────────────
    sock.on('channel-bot:cancel-thread', async (payload: { sid: string; threadId: string; reason?: string }, ack: RpcAck) => {
        try {
            const ctx = ensureBotOnly(payload.sid)
            if (!ctx.ok) return ack({ ok: false, error: ctx.error })
            const engine = getSyncEngine()
            if (!engine) return ack({ ok: false, error: 'SyncEngine unavailable' })
            await engine.cancelThreadSession(payload.threadId, ctx.namespace, payload.reason)
            ack({ ok: true, data: { ok: true } })
        } catch (e) {
            ack({ ok: false, error: e instanceof Error ? e.message : String(e) })
        }
    })

    // ─── send_to_thread ───────────────────────────────────────────────
    sock.on('channel-bot:send-to-thread', async (payload: { sid: string; threadId: string; text: string }, ack: RpcAck) => {
        try {
            const ctx = resolveChannelContext(payload.sid)
            if (!ctx.ok) return ack({ ok: false, error: ctx.error })
            const engine = getSyncEngine()
            if (!engine) return ack({ ok: false, error: 'SyncEngine unavailable' })
            // Verify target thread is in the same channel
            const target = store.sessions.getSessionByNamespace(payload.threadId, ctx.namespace)
            if (!target) return ack({ ok: false, error: `Target thread ${payload.threadId} not found` })
            if (target.channelId !== ctx.channelId) return ack({ ok: false, error: 'Cannot send_to_thread across channels' })
            const tag = ctx.isBot ? 'bot' : 'sibling-thread'
            await engine.sendMessage(payload.threadId, {
                text: `<system>injected-by-${tag}</system>\n${payload.text}`,
                sentFrom: 'webapp'
            })
            ack({ ok: true, data: { messageId: '' } })
        } catch (e) {
            ack({ ok: false, error: e instanceof Error ? e.message : String(e) })
        }
    })

    // ─── pin_thread (bot only) ────────────────────────────────────────
    sock.on('channel-bot:pin-thread', async (payload: { sid: string; threadId: string }, ack: RpcAck) => {
        try {
            const ctx = ensureBotOnly(payload.sid)
            if (!ctx.ok) return ack({ ok: false, error: ctx.error })
            const engine = getSyncEngine()
            if (!engine) return ack({ ok: false, error: 'SyncEngine unavailable' })
            const target = store.sessions.getSessionByNamespace(payload.threadId, ctx.namespace)
            if (!target || target.channelId !== ctx.channelId) {
                return ack({ ok: false, error: `Thread ${payload.threadId} not in this channel` })
            }
            engine.setSessionPinned(payload.threadId, ctx.namespace, true)
            ack({ ok: true, data: { ok: true } })
        } catch (e) {
            ack({ ok: false, error: e instanceof Error ? e.message : String(e) })
        }
    })

    // ─── unpin_thread (bot only) ──────────────────────────────────────
    sock.on('channel-bot:unpin-thread', async (payload: { sid: string; threadId: string }, ack: RpcAck) => {
        try {
            const ctx = ensureBotOnly(payload.sid)
            if (!ctx.ok) return ack({ ok: false, error: ctx.error })
            const engine = getSyncEngine()
            if (!engine) return ack({ ok: false, error: 'SyncEngine unavailable' })
            const target = store.sessions.getSessionByNamespace(payload.threadId, ctx.namespace)
            if (!target || target.channelId !== ctx.channelId) {
                return ack({ ok: false, error: `Thread ${payload.threadId} not in this channel` })
            }
            engine.setSessionPinned(payload.threadId, ctx.namespace, false)
            ack({ ok: true, data: { ok: true } })
        } catch (e) {
            ack({ ok: false, error: e instanceof Error ? e.message : String(e) })
        }
    })

    // ─── list_threads ─────────────────────────────────────────────────
    sock.on('channel-bot:list-threads', async (payload: { sid: string }, ack: RpcAck) => {
        try {
            const ctx = resolveChannelContext(payload.sid)
            if (!ctx.ok) return ack({ ok: false, error: ctx.error })
            const sessions = store.sessions.getSessionsByChannel(ctx.channelId, ctx.namespace)
            const threads = sessions
                .filter((s) => !s.isChannelBot) // exclude the bot itself
                .map((s) => ({
                    id: s.id,
                    title: s.threadTitle,
                    status: s.threadStatus,
                    visibility: s.visibility,
                    scheduled: s.scheduled,
                    schedule: s.schedule,
                    pinned: s.pinned,
                    active: s.active,
                    createdAt: s.createdAt,
                    updatedAt: s.updatedAt
                }))
            ack({ ok: true, data: { threads } })
        } catch (e) {
            ack({ ok: false, error: e instanceof Error ? e.message : String(e) })
        }
    })

    // ─── get_thread ───────────────────────────────────────────────────
    sock.on('channel-bot:get-thread', async (payload: { sid: string; threadId: string }, ack: RpcAck) => {
        try {
            const ctx = resolveChannelContext(payload.sid)
            if (!ctx.ok) return ack({ ok: false, error: ctx.error })
            const target = store.sessions.getSessionByNamespace(payload.threadId, ctx.namespace)
            if (!target) return ack({ ok: false, error: `Thread ${payload.threadId} not found` })
            if (target.channelId !== ctx.channelId) return ack({ ok: false, error: 'Cannot read thread across channels' })
            ack({
                ok: true,
                data: {
                    thread: {
                        id: target.id,
                        title: target.threadTitle,
                        status: target.threadStatus,
                        visibility: target.visibility,
                        scheduled: target.scheduled,
                        schedule: target.schedule,
                        pinned: target.pinned,
                        active: target.active,
                        todos: target.todos,
                        createdAt: target.createdAt,
                        updatedAt: target.updatedAt
                    }
                }
            })
        } catch (e) {
            ack({ ok: false, error: e instanceof Error ? e.message : String(e) })
        }
    })

    // ─── get_channel_history ──────────────────────────────────────────
    sock.on('channel-bot:get-channel-history', async (payload: { sid: string; beforeSeq?: number; limit?: number }, ack: RpcAck) => {
        try {
            const ctx = resolveChannelContext(payload.sid)
            if (!ctx.ok) return ack({ ok: false, error: ctx.error })
            const messages = store.channelMessages.getMessages(ctx.channelId, {
                before: payload.beforeSeq,
                limit: payload.limit ?? 50
            })
            ack({
                ok: true,
                data: {
                    messages: messages.map((m) => ({
                        id: m.id,
                        kind: m.kind,
                        authorUserId: m.authorUserId,
                        body: m.body,
                        seq: m.seq,
                        createdAt: m.createdAt
                    }))
                }
            })
        } catch (e) {
            ack({ ok: false, error: e instanceof Error ? e.message : String(e) })
        }
    })

    // ─── list_channel_members ─────────────────────────────────────────
    sock.on('channel-bot:list-channel-members', async (payload: { sid: string }, ack: RpcAck) => {
        try {
            const ctx = resolveChannelContext(payload.sid)
            if (!ctx.ok) return ack({ ok: false, error: ctx.error })
            const members = store.channels.getMembers(ctx.channelId)
            const enriched = members.map((m) => {
                const wsUser = store.workspaceUsers.getUser(ctx.namespace, m.userId)
                return {
                    userId: m.userId,
                    displayName: wsUser?.displayName ?? m.userId,
                    role: m.role
                }
            })
            ack({ ok: true, data: { members: enriched } })
        } catch (e) {
            ack({ ok: false, error: e instanceof Error ? e.message : String(e) })
        }
    })
}
