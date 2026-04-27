import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'
import type { Context } from 'hono'

async function parseBody<T>(c: Context): Promise<T | null> {
    try { return await c.req.json<T>() } catch { return null }
}

export function createChannelsRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // GET /channels — list channels for current user (by membership)
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
        const channel = engine.createChannel(namespace, body.name, userId, body.description, body.agentConfig)
        const memberAdded = engine.addChannelMember(channel.id, userId, 'owner')
        if (!memberAdded) throw new Error(`Failed to add creator as owner of channel ${channel.id}`)
        return c.json({ channel }, 201)
    })

    // GET /channels/:id — get channel (membership check)
    app.get('/channels/:id', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const namespace = c.get('namespace')
        const userId = String(c.get('userId'))
        const id = c.req.param('id')
        const channel = engine.getChannel(id, namespace)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!engine.isChannelMember(id, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
        return c.json({ channel })
    })

    // PUT /channels/:id — update channel (membership check)
    app.put('/channels/:id', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const namespace = c.get('namespace')
        const userId = String(c.get('userId'))
        const id = c.req.param('id')
        const channel = engine.getChannel(id, namespace)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!engine.isChannelMember(id, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
        const body = await parseBody<{ name?: string; description?: string | null; agentConfig?: unknown | null }>(c)
        if (!body) return c.json({ error: 'Invalid body' }, 400)
        const updated = engine.updateChannelData(id, namespace, body)
        if (!updated) return c.json({ error: 'Failed to update channel' }, 500)
        return c.json({ channel: engine.getChannel(id, namespace)! })
    })

    // DELETE /channels/:id — delete channel (membership + personal channel protection + detach sessions)
    app.delete('/channels/:id', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const namespace = c.get('namespace')
        const userId = String(c.get('userId'))
        const id = c.req.param('id')
        const channel = engine.getChannel(id, namespace)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!engine.isChannelMember(id, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
        if (engine.isPersonalChannel(id)) {
            return c.json({ error: 'Cannot delete personal channel' }, 403)
        }
        const deleted = engine.deleteChannel(id, namespace)
        if (!deleted) return c.json({ error: 'Failed to delete channel' }, 500)
        return c.json({ ok: true })
    })

    // GET /channels/:id/members — list members (membership check)
    app.get('/channels/:id/members', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const namespace = c.get('namespace')
        const userId = String(c.get('userId'))
        const id = c.req.param('id')
        const channel = engine.getChannel(id, namespace)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!engine.isChannelMember(id, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
        return c.json({ members: engine.getChannelMembers(id) })
    })

    // POST /channels/:id/members — add member (membership check)
    app.post('/channels/:id/members', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const namespace = c.get('namespace')
        const userId = String(c.get('userId'))
        const id = c.req.param('id')
        const channel = engine.getChannel(id, namespace)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!engine.isChannelMember(id, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
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
        const namespace = c.get('namespace')
        const userId = String(c.get('userId'))
        const id = c.req.param('id')
        const target = c.req.param('userId')
        const channel = engine.getChannel(id, namespace)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!engine.isChannelMember(id, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
        const removed = engine.removeChannelMember(id, target)
        if (!removed) return c.json({ error: 'Member not found' }, 404)
        return c.json({ ok: true })
    })

    // GET /channels/:id/messages — list messages with cursor pagination
    app.get('/channels/:id/messages', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const namespace = c.get('namespace')
        const userId = String(c.get('userId'))
        const id = c.req.param('id')
        const channel = engine.getChannel(id, namespace)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!engine.isChannelMember(id, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
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
            const wsUser = engine.getWorkspaceUser(namespace, msg.authorUserId)
            return { ...base, authorDisplayName: wsUser?.displayName ?? msg.authorUserId }
        })
        return c.json({ messages: enriched })
    })

    // POST /channels/:id/messages/:messageId/reactions — toggle a reaction (Stage 2)
    app.post('/channels/:id/messages/:messageId/reactions', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const namespace = c.get('namespace')
        const userId = String(c.get('userId'))
        const channelId = c.req.param('id')
        const messageId = c.req.param('messageId')
        const channel = engine.getChannel(channelId, namespace)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!engine.isChannelMember(channelId, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
        const body = await parseBody<{ emoji: string }>(c)
        if (!body || typeof body.emoji !== 'string' || body.emoji.length === 0) {
            return c.json({ error: 'emoji required' }, 400)
        }
        const result = engine.toggleMessageReaction(messageId, channelId, namespace, `user:${userId}`, body.emoji)
        return c.json({ result: result.result })
    })

    // DELETE /channels/:id/messages/:messageId/reactions/:emoji — explicit remove
    app.delete('/channels/:id/messages/:messageId/reactions/:emoji', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const namespace = c.get('namespace')
        const userId = String(c.get('userId'))
        const channelId = c.req.param('id')
        const messageId = c.req.param('messageId')
        const emoji = decodeURIComponent(c.req.param('emoji'))
        const channel = engine.getChannel(channelId, namespace)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!engine.isChannelMember(channelId, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
        const removed = engine.removeMessageReaction(messageId, channelId, namespace, `user:${userId}`, emoji)
        return c.json({ removed })
    })

    // POST /channels/:id/messages — send message (membership check)
    app.post('/channels/:id/messages', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const namespace = c.get('namespace')
        const userId = String(c.get('userId'))
        const id = c.req.param('id')
        const channel = engine.getChannel(id, namespace)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!engine.isChannelMember(id, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
        const body = await parseBody<{ kind?: string; body: unknown; threadSessionId?: string }>(c)
        if (!body || body.body === undefined || body.body === null) {
            return c.json({ error: 'body is required' }, 400)
        }
        const validKinds = ['text', 'thread_card', 'agent_summary']
        const kind = body.kind && validKinds.includes(body.kind) ? body.kind : 'text'
        const message = engine.sendChannelMessage(
            id, namespace, userId, kind, body.body, body.threadSessionId
        )
        return c.json({ message }, 201)
    })

    // GET /channels/:id/sessions — list sessions in channel (membership check)
    app.get('/channels/:id/sessions', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const namespace = c.get('namespace')
        const userId = String(c.get('userId'))
        const id = c.req.param('id')
        const channel = engine.getChannel(id, namespace)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!engine.isChannelMember(id, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
        return c.json({ sessions: engine.getSessionsByChannel(id, namespace) })
    })

    // POST /channels/:id/sessions/:sessionId/detach — detach a session from a channel
    app.post('/channels/:id/sessions/:sessionId/detach', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const namespace = c.get('namespace')
        const userId = String(c.get('userId'))
        const channelId = c.req.param('id')
        const sessionId = c.req.param('sessionId')
        const channel = engine.getChannel(channelId, namespace)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!engine.isChannelMember(channelId, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
        const session = engine.getSessionByNamespace(sessionId, namespace)
        if (!session) return c.json({ error: 'Session not found' }, 404)
        if (session.channelId !== channelId) return c.json({ error: 'Session is not in this channel' }, 400)
        // Detach just this session — store-level targeted update
        engine.detachSession(sessionId, channelId, namespace)
        return c.json({ ok: true })
    })

    // POST /channels/:id/sessions — create thread in channel
    app.post('/channels/:id/sessions', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const namespace = c.get('namespace')
        const userId = String(c.get('userId'))
        const channelId = c.req.param('id')
        const channel = engine.getChannel(channelId, namespace)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!engine.isChannelMember(channelId, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
        const body = await parseBody<{ threadTitle?: string; metadata?: unknown }>(c)
        if (!body || !body.threadTitle || typeof body.threadTitle !== 'string') {
            return c.json({ error: 'threadTitle is required' }, 400)
        }
        const session = engine.createThreadInChannel(channelId, namespace, userId, body.threadTitle, body.metadata)
        return c.json({ session }, 201)
    })

    // POST /channels/:id/invite — create invite link
    app.post('/channels/:id/invite', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const namespace = c.get('namespace')
        const userId = String(c.get('userId'))
        const channelId = c.req.param('id')
        const channel = engine.getChannel(channelId, namespace)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!engine.isChannelMember(channelId, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
        const invite = engine.createChannelInvite(channelId, namespace, userId)
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
