import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'
import type { Context } from 'hono'

async function parseBody<T>(c: Context): Promise<T | null> {
    try { return await c.req.json<T>() } catch { return null }
}

/**
 * Stage 2: resolve a channel by id with membership-based access control.
 *
 * Cross-namespace by design — Bob (ns=bob) joining Alice's #engineering
 * (ns=alice) needs to read/write that channel without his caller-namespace
 * matching the channel-namespace. Returns the channel so callers can use
 * `channel.namespace` for any downstream storage operations that still
 * need the channel's actual namespace.
 */
function requireChannelMember(
    c: Context<WebAppEnv>,
    engine: SyncEngine,
    channelId: string
): { channel: ReturnType<SyncEngine['getChannelById']> & object } | Response {
    const userId = String(c.get('userId'))
    const channel = engine.getChannelById(channelId)
    if (!channel) return c.json({ error: 'Channel not found' }, 404)
    if (!engine.isChannelMember(channelId, userId)) {
        return c.json({ error: 'Not a member of this channel' }, 403)
    }
    return { channel }
}

export function createChannelsRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // GET /channels — list channels for current user (by membership, cross-namespace)
    app.get('/channels', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const namespace = c.get('namespace')
        const userId = String(c.get('userId'))
        return c.json({ channels: engine.getChannelsForUser(namespace, userId) })
    })

    // POST /channels — create channel, creator auto-becomes owner member
    app.post('/channels', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const namespace = c.get('namespace')
        const userId = String(c.get('userId'))
        const body = await parseBody<{ name?: string; description?: string; agentConfig?: unknown }>(c)
        if (!body || !body.name || typeof body.name !== 'string') {
            return c.json({ error: 'name is required' }, 400)
        }
        // Stage 2: reject duplicate channel names within the same namespace.
        // Without this two `# paper-cvpr-25` rows can coexist with different
        // ids — sidebar shows two indistinguishable buttons, the workspace
        // folder collides at `~/.hapi/workspaces/<ns>/<name>/`, and the bot's
        // system prompt references an ambiguous channel.
        const existing = engine.getChannelByName(namespace, body.name.trim())
        if (existing) {
            return c.json({
                error: `Channel name "${body.name.trim()}" already exists in this workspace`,
                existingChannelId: existing.id
            }, 409)
        }
        const channel = engine.createChannel(namespace, body.name, userId, body.description, body.agentConfig)
        const memberAdded = engine.addChannelMember(channel.id, userId, 'owner')
        if (!memberAdded) throw new Error(`Failed to add creator as owner of channel ${channel.id}`)
        return c.json({ channel }, 201)
    })

    // GET /channels/:id — get channel (membership check, cross-namespace)
    app.get('/channels/:id', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const id = c.req.param('id')
        const r = requireChannelMember(c, engine, id)
        if (r instanceof Response) return r
        return c.json({ channel: r.channel })
    })

    // PUT /channels/:id — update channel (membership check; agentConfig requires owner)
    app.put('/channels/:id', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const userId = String(c.get('userId'))
        const id = c.req.param('id')
        const r = requireChannelMember(c, engine, id)
        if (r instanceof Response) return r
        const channel = r.channel
        const body = await parseBody<{ name?: string; description?: string | null; agentConfig?: unknown | null }>(c)
        if (!body) return c.json({ error: 'Invalid body' }, 400)
        // Stage 2: editing agentConfig is owner-only (drives bot identity / behavior).
        if (body.agentConfig !== undefined && channel.createdBy !== userId) {
            return c.json({ error: 'Only the channel owner can edit agentConfig' }, 403)
        }
        const updated = engine.updateChannelData(id, channel.namespace, body)
        if (!updated) return c.json({ error: 'Failed to update channel' }, 500)
        return c.json({ channel: engine.getChannelById(id)! })
    })

    // DELETE /channels/:id — delete channel (membership + personal channel protection + detach sessions)
    // Stage 2: ?hard=true also removes the workspace folder (default soft = rename to -archived)
    app.delete('/channels/:id', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const userId = String(c.get('userId'))
        const id = c.req.param('id')
        const r = requireChannelMember(c, engine, id)
        if (r instanceof Response) return r
        const channel = r.channel
        // Stage 2: only the channel owner (creator) can delete; preventing
        // any random invited member from deleting Alice's channel.
        if (channel.createdBy !== userId) {
            return c.json({ error: 'Only the channel owner can delete the channel' }, 403)
        }
        if (engine.isPersonalChannel(id)) {
            return c.json({ error: 'Cannot delete personal channel' }, 403)
        }
        const hard = c.req.query('hard') === 'true' || c.req.query('hard') === '1'
        const deleted = engine.deleteChannel(id, channel.namespace, { hardDelete: hard })
        if (!deleted) return c.json({ error: 'Failed to delete channel' }, 500)
        return c.json({ ok: true, hard })
    })

    // GET /channels/:id/members — list members (membership check)
    app.get('/channels/:id/members', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const id = c.req.param('id')
        const r = requireChannelMember(c, engine, id)
        if (r instanceof Response) return r
        // Stage 2 cross-namespace: members come from many namespaces, so enrich
        // each row with displayName (and namespace) via the global lookup so the
        // web UI can show "Alice Wei (alice)" instead of raw userId.
        const members = engine.getChannelMembers(id)
        const enriched = members.map((m) => {
            const u = engine.getWorkspaceUserGlobal(m.userId)
            return {
                ...m,
                displayName: u?.displayName ?? m.userId,
                namespace: u?.namespace ?? null
            }
        })
        return c.json({ members: enriched })
    })

    // POST /channels/:id/members — add member (membership check)
    app.post('/channels/:id/members', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const id = c.req.param('id')
        const r = requireChannelMember(c, engine, id)
        if (r instanceof Response) return r
        const body = await parseBody<{ userId: string; role?: string }>(c)
        if (!body || !body.userId || typeof body.userId !== 'string') {
            return c.json({ error: 'userId is required' }, 400)
        }
        const added = engine.addChannelMember(id, body.userId, body.role || 'member')
        return c.json({ ok: true, added })
    })

    // DELETE /channels/:id/members/:userId — remove member (membership check)
    app.delete('/channels/:id/members/:userId', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const id = c.req.param('id')
        const target = c.req.param('userId')
        const r = requireChannelMember(c, engine, id)
        if (r instanceof Response) return r
        const removed = engine.removeChannelMember(id, target)
        if (!removed) return c.json({ error: 'Member not found' }, 404)
        return c.json({ ok: true })
    })

    // GET /channels/:id/messages — list messages with cursor pagination
    app.get('/channels/:id/messages', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const id = c.req.param('id')
        const r = requireChannelMember(c, engine, id)
        if (r instanceof Response) return r
        const channel = r.channel
        const beforeRaw = c.req.query('before')
        const limitRaw = c.req.query('limit')
        const before = beforeRaw ? Number(beforeRaw) : undefined
        const limit = limitRaw ? Number(limitRaw) : undefined
        if (before !== undefined && isNaN(before)) return c.json({ error: 'Invalid before parameter' }, 400)
        if (limit !== undefined && isNaN(limit)) return c.json({ error: 'Invalid limit parameter' }, 400)
        const messages = engine.getChannelMessages(id, { before, limit })
        // Stage 2: bulk-fetch reactions for all returned messages
        const reactionsByMessage = engine.getReactionsForMessages(messages.map((m) => m.id))
        const enriched = messages.map((msg) => {
            const reactions = reactionsByMessage.get(msg.id) ?? []
            const base = { ...msg, reactions }
            if (!msg.authorUserId) return base
            // Stage 2: channels are membership-based across namespaces, so the
            // author may live in a different namespace than the channel owner.
            // Try the channel's namespace first, then fall back to the global
            // lookup so cross-ns members render with their real displayName.
            const localUser = engine.getWorkspaceUser(channel.namespace, msg.authorUserId)
            const displayName = localUser?.displayName
                ?? engine.getDisplayNameForUser(msg.authorUserId)
                ?? msg.authorUserId
            return { ...base, authorDisplayName: displayName }
        })
        return c.json({ messages: enriched })
    })

    // POST /channels/:id/messages/:messageId/reactions — toggle a reaction (Stage 2)
    app.post('/channels/:id/messages/:messageId/reactions', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const userId = String(c.get('userId'))
        const channelId = c.req.param('id')
        const messageId = c.req.param('messageId')
        const r = requireChannelMember(c, engine, channelId)
        if (r instanceof Response) return r
        const channel = r.channel
        const body = await parseBody<{ emoji: string }>(c)
        if (!body || typeof body.emoji !== 'string' || body.emoji.length === 0) {
            return c.json({ error: 'emoji required' }, 400)
        }
        const result = engine.toggleMessageReaction(messageId, channelId, channel.namespace, `user:${userId}`, body.emoji)
        return c.json({ result: result.result })
    })

    // DELETE /channels/:id/messages/:messageId/reactions/:emoji — explicit remove
    app.delete('/channels/:id/messages/:messageId/reactions/:emoji', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const userId = String(c.get('userId'))
        const channelId = c.req.param('id')
        const messageId = c.req.param('messageId')
        const emoji = decodeURIComponent(c.req.param('emoji'))
        const r = requireChannelMember(c, engine, channelId)
        if (r instanceof Response) return r
        const channel = r.channel
        const removed = engine.removeMessageReaction(messageId, channelId, channel.namespace, `user:${userId}`, emoji)
        return c.json({ removed })
    })

    // POST /channels/:id/messages — send message (membership check)
    app.post('/channels/:id/messages', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const userId = String(c.get('userId'))
        const id = c.req.param('id')
        const r = requireChannelMember(c, engine, id)
        if (r instanceof Response) return r
        const channel = r.channel
        const body = await parseBody<{ kind?: string; body: unknown; threadSessionId?: string }>(c)
        if (!body || body.body === undefined || body.body === null) {
            return c.json({ error: 'body is required' }, 400)
        }
        const validKinds = ['text', 'thread_card', 'agent_summary']
        const kind = body.kind && validKinds.includes(body.kind) ? body.kind : 'text'
        const message = engine.sendChannelMessage(
            id, channel.namespace, userId, kind, body.body, body.threadSessionId
        )
        return c.json({ message }, 201)
    })

    // GET /channels/:id/sessions — list sessions in channel (membership check)
    app.get('/channels/:id/sessions', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const id = c.req.param('id')
        const r = requireChannelMember(c, engine, id)
        if (r instanceof Response) return r
        const sessions = engine.getSessionsByChannel(id, r.channel.namespace)
            .filter((s) => !s.isChannelBot)
        // Stage 2: enrich each session with createdByDisplayName (cross-ns
        // workspace lookup) so the web ThreadCard can render "by Alice"
        // instead of falling back to the raw userId for invited members.
        const enriched = sessions.map((s) => {
            const sAny = s as typeof s & { createdByUserId?: string; createdByDisplayName?: string }
            const uid = sAny.createdByUserId
            if (!uid) return s
            const displayName = engine.getDisplayNameForUser(uid)
            if (!displayName) return s
            return { ...s, createdByDisplayName: displayName }
        })
        return c.json({ sessions: enriched })
    })

    // POST /channels/:id/sessions/:sessionId/detach — detach a session from a channel
    app.post('/channels/:id/sessions/:sessionId/detach', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const channelId = c.req.param('id')
        const sessionId = c.req.param('sessionId')
        const r = requireChannelMember(c, engine, channelId)
        if (r instanceof Response) return r
        const channel = r.channel
        const session = engine.getSessionByNamespace(sessionId, channel.namespace)
        if (!session) return c.json({ error: 'Session not found' }, 404)
        if (session.channelId !== channelId) return c.json({ error: 'Session is not in this channel' }, 400)
        // Detach just this session — store-level targeted update
        engine.detachSession(sessionId, channelId, channel.namespace)
        return c.json({ ok: true })
    })

    // POST /channels/:id/sessions — create thread in channel
    app.post('/channels/:id/sessions', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const userId = String(c.get('userId'))
        const channelId = c.req.param('id')
        const r = requireChannelMember(c, engine, channelId)
        if (r instanceof Response) return r
        const channel = r.channel
        const body = await parseBody<{ threadTitle?: string; metadata?: unknown }>(c)
        if (!body || !body.threadTitle || typeof body.threadTitle !== 'string') {
            return c.json({ error: 'threadTitle is required' }, 400)
        }
        const session = engine.createThreadInChannel(channelId, channel.namespace, userId, body.threadTitle, body.metadata)
        return c.json({ session }, 201)
    })

    // POST /channels/:id/thread-request — Stage 2: user clicked "+ New thread".
    // Doesn't create a thread directly; emits a strong-signal event that
    // ChannelAgent forwards to the bot session, which is in charge of
    // actually calling spawn_thread via MCP.
    app.post('/channels/:id/thread-request', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const userId = String(c.get('userId'))
        const channelId = c.req.param('id')
        const r = requireChannelMember(c, engine, channelId)
        if (r instanceof Response) return r
        const channel = r.channel
        const body = await parseBody<{ topic?: string }>(c)
        const topic = typeof body?.topic === 'string' ? body.topic.trim() : ''
        if (!topic) {
            return c.json({ error: 'topic is required' }, 400)
        }
        // Stage 2: surface a 409 instead of silently 200'ing when the channel
        // currently has no bot to forward to (audit finding from item-5 review).
        if (!channel.botSessionId) {
            return c.json({
                error: 'Channel has no bot — set agentConfig in Channel settings first'
            }, 409)
        }
        const accepted = engine.requestNewThread(channelId, channel.namespace, userId, topic)
        if (!accepted) {
            return c.json({ ok: true, deduped: true })
        }
        return c.json({ ok: true })
    })

    // POST /channels/:id/invite — create invite link
    app.post('/channels/:id/invite', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const userId = String(c.get('userId'))
        const channelId = c.req.param('id')
        const r = requireChannelMember(c, engine, channelId)
        if (r instanceof Response) return r
        const channel = r.channel
        const invite = engine.createChannelInvite(channelId, channel.namespace, userId)
        return c.json({ invite }, 201)
    })

    // POST /invite/:token — accept invite
    app.post('/invite/:token', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const namespace = c.get('namespace')
        const userId = String(c.get('userId'))
        const token = c.req.param('token')
        const result = engine.acceptChannelInvite(token, userId, namespace)
        if (!result) return c.json({ error: 'Invalid or expired invite' }, 404)
        return c.json({ channelId: result.channelId })
    })

    // POST /workspace/ensure-defaults — create #general + personal channel
    app.post('/workspace/ensure-defaults', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const namespace = c.get('namespace')
        const userId = String(c.get('userId'))
        const body = await parseBody<{ displayName?: string }>(c)
        if (!body || !body.displayName || typeof body.displayName !== 'string') {
            return c.json({ error: 'displayName is required' }, 400)
        }
        const result = engine.ensureWorkspaceDefaults(namespace, userId, body.displayName)
        return c.json(result)
    })

    // GET /workspace/presence — list online users in namespace
    app.get('/workspace/presence', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const namespace = c.get('namespace')
        const userIds = engine.getOnlineUserIds(namespace)
        return c.json({ online: userIds })
    })

    return app
}
