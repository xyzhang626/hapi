import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../../store'

// --------------------------------------------------------------------------
// Types & helpers
// --------------------------------------------------------------------------

type ChannelTestEnv = {
    Variables: {
        userId: string
        namespace: string
    }
}

/**
 * Insert a session row that is linked to a channel via raw SQL.
 * The Store's getOrCreateSession does not accept a channel_id,
 * so test setup must go through the underlying Database.
 */
function createSessionInChannel(
    db: Database,
    namespace: string,
    channelId: string,
    opts?: { title?: string; userId?: string }
): string {
    const id = randomUUID()
    const now = Date.now()
    db.prepare(`
        INSERT INTO sessions (id, tag, namespace, created_at, updated_at,
                              channel_id, thread_title, thread_status, created_by_user_id)
        VALUES (@id, @tag, @namespace, @now, @now,
                @channel_id, @thread_title, 'active', @created_by)
    `).run({
        id,
        tag: `tag-${id}`,
        namespace,
        now,
        channel_id: channelId,
        thread_title: opts?.title ?? null,
        created_by: opts?.userId ?? null
    })
    return id
}

/**
 * Build a Hono app backed by a real in-memory Store.
 *
 * The returned app exposes channel routes that mirror what the production
 * channels.ts would implement: every handler goes through Store methods
 * with membership checks, namespace scoping, and personal-channel protection.
 *
 * Per-request user identity is controlled via the `x-test-user-id` header
 * (falls back to `defaultUserId`).  Namespace is controlled via `x-test-namespace`
 * (falls back to `'default'`).
 */
function createTestEnv(defaultUserId: string = 'alice') {
    const store = new Store(':memory:')
    // The Store keeps its Database private; tests that need raw SQL
    // (e.g. inserting a session with channel_id) reach through here.
    const db = (store as any).db as Database

    const app = new Hono<ChannelTestEnv>()

    // --- test auth middleware ---
    app.use('*', async (c, next) => {
        c.set('namespace', c.req.header('x-test-namespace') || 'default')
        c.set('userId', c.req.header('x-test-user-id') || defaultUserId)
        await next()
    })

    // ---------------------------------------------------------------
    // Channel CRUD
    // ---------------------------------------------------------------

    app.get('/api/channels', (c) => {
        const ns = c.get('namespace')
        const userId = c.get('userId')
        return c.json({ channels: store.channels.getChannelsForUser(ns, userId) })
    })

    app.post('/api/channels', async (c) => {
        const ns = c.get('namespace')
        const userId = c.get('userId')
        const body = await c.req.json<{ name?: string; description?: string; agentConfig?: unknown }>()
        if (!body.name || typeof body.name !== 'string') {
            return c.json({ error: 'name is required' }, 400)
        }
        const channel = store.channels.createChannel(ns, body.name, userId, body.description, body.agentConfig)
        store.channels.addMember(channel.id, userId, 'owner')
        return c.json({ channel }, 201)
    })

    app.get('/api/channels/:id', (c) => {
        const ns = c.get('namespace')
        const userId = c.get('userId')
        const id = c.req.param('id')
        const channel = store.channels.getChannel(id, ns)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!store.channels.isMember(id, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
        return c.json({ channel })
    })

    app.put('/api/channels/:id', async (c) => {
        const ns = c.get('namespace')
        const userId = c.get('userId')
        const id = c.req.param('id')
        const channel = store.channels.getChannel(id, ns)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!store.channels.isMember(id, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
        const body = await c.req.json<{ name?: string; description?: string | null; agentConfig?: unknown | null }>()
        store.channels.updateChannel(id, ns, body)
        return c.json({ channel: store.channels.getChannel(id, ns)! })
    })

    app.delete('/api/channels/:id', (c) => {
        const ns = c.get('namespace')
        const userId = c.get('userId')
        const id = c.req.param('id')
        const channel = store.channels.getChannel(id, ns)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!store.channels.isMember(id, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
        if (store.workspaceUsers.isPersonalChannel(id)) {
            return c.json({ error: 'Cannot delete personal channel' }, 403)
        }
        // Sessions reference channels with ON DELETE RESTRICT; detach first.
        store.sessions.detachSessionsFromChannel(id, ns)
        const deleted = store.channels.deleteChannel(id, ns)
        if (!deleted) return c.json({ error: 'Failed to delete channel' }, 500)
        return c.json({ ok: true })
    })

    // ---------------------------------------------------------------
    // Members
    // ---------------------------------------------------------------

    app.get('/api/channels/:id/members', (c) => {
        const ns = c.get('namespace')
        const userId = c.get('userId')
        const id = c.req.param('id')
        const channel = store.channels.getChannel(id, ns)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!store.channels.isMember(id, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
        return c.json({ members: store.channels.getMembers(id) })
    })

    app.post('/api/channels/:id/members', async (c) => {
        const ns = c.get('namespace')
        const userId = c.get('userId')
        const id = c.req.param('id')
        const channel = store.channels.getChannel(id, ns)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!store.channels.isMember(id, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
        const body = await c.req.json<{ userId: string; role?: string }>()
        const added = store.channels.addMember(id, body.userId, body.role || 'member')
        return c.json({ ok: true, added })
    })

    app.delete('/api/channels/:id/members/:userId', (c) => {
        const ns = c.get('namespace')
        const userId = c.get('userId')
        const id = c.req.param('id')
        const target = c.req.param('userId')
        const channel = store.channels.getChannel(id, ns)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!store.channels.isMember(id, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
        store.channels.removeMember(id, target)
        return c.json({ ok: true })
    })

    // ---------------------------------------------------------------
    // Channel messages
    // ---------------------------------------------------------------

    app.post('/api/channels/:id/messages', async (c) => {
        const ns = c.get('namespace')
        const userId = c.get('userId')
        const id = c.req.param('id')
        const channel = store.channels.getChannel(id, ns)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!store.channels.isMember(id, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
        const body = await c.req.json<{ kind?: string; body: unknown; threadSessionId?: string }>()
        const message = store.channelMessages.addMessage(
            id, ns, userId, body.kind || 'text', body.body, body.threadSessionId
        )
        return c.json({ message }, 201)
    })

    app.get('/api/channels/:id/messages', (c) => {
        const ns = c.get('namespace')
        const userId = c.get('userId')
        const id = c.req.param('id')
        const channel = store.channels.getChannel(id, ns)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!store.channels.isMember(id, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
        const before = c.req.query('before')
        const limit = c.req.query('limit')
        const messages = store.channelMessages.getMessages(id, {
            before: before ? Number(before) : undefined,
            limit: limit ? Number(limit) : undefined
        })
        return c.json({ messages })
    })

    // ---------------------------------------------------------------
    // Channel-session linking
    // ---------------------------------------------------------------

    app.get('/api/channels/:id/sessions', (c) => {
        const ns = c.get('namespace')
        const userId = c.get('userId')
        const id = c.req.param('id')
        const channel = store.channels.getChannel(id, ns)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!store.channels.isMember(id, userId)) return c.json({ error: 'Not a member of this channel' }, 403)
        return c.json({ sessions: store.sessions.getSessionsByChannel(id, ns) })
    })

    app.post('/api/channels/:id/sessions/:sessionId/detach', (c) => {
        const ns = c.get('namespace')
        const userId = c.get('userId')
        const channelId = c.req.param('id')
        const sessionId = c.req.param('sessionId')
        const channel = store.channels.getChannel(channelId, ns)
        if (!channel) return c.json({ error: 'Channel not found' }, 404)
        if (!store.channels.isMember(channelId, userId)) {
            return c.json({ error: 'Not a member of this channel' }, 403)
        }
        const session = store.sessions.getSessionByNamespace(sessionId, ns)
        if (!session) return c.json({ error: 'Session not found' }, 404)
        if (session.channelId !== channelId) {
            return c.json({ error: 'Session is not in this channel' }, 400)
        }
        // Store has no single-session-detach; use raw SQL.
        db.prepare(
            'UPDATE sessions SET channel_id = NULL WHERE id = @id AND namespace = @ns AND channel_id = @cid'
        ).run({ id: sessionId, ns, cid: channelId })
        return c.json({ ok: true })
    })

    // ---------------------------------------------------------------
    // Workspace defaults
    // ---------------------------------------------------------------

    app.post('/api/workspace/ensure-defaults', async (c) => {
        const ns = c.get('namespace')
        const userId = c.get('userId')
        const body = await c.req.json<{ displayName?: string }>()
        if (!body.displayName || typeof body.displayName !== 'string') {
            return c.json({ error: 'displayName is required' }, 400)
        }
        const result = store.workspaceUsers.ensureDefaults(ns, userId, body.displayName)
        return c.json(result)
    })

    return { app, store, db }
}

/** Convenience wrapper for JSON POST / PUT requests. */
function jsonRequest(
    app: Hono<ChannelTestEnv>,
    method: string,
    path: string,
    body?: object,
    headers?: Record<string, string>
): Promise<Response> {
    const init: RequestInit = { method }
    if (body !== undefined) {
        init.headers = { 'Content-Type': 'application/json', ...headers }
        init.body = JSON.stringify(body)
    } else {
        init.headers = headers
    }
    return Promise.resolve(app.request(path, init))
}

// ==========================================================================
// Tests
// ==========================================================================

describe('channels E2E', () => {
    // ------------------------------------------------------------------
    // 1. Full channel lifecycle via HTTP
    // ------------------------------------------------------------------
    describe('full channel lifecycle via HTTP', () => {
        it('create -> update -> add members -> send messages -> paginate -> remove member -> delete', async () => {
            const { app } = createTestEnv('alice')

            // -- create --
            const createRes = await jsonRequest(app, 'POST', '/api/channels', {
                name: 'engineering',
                description: 'Engineering team'
            })
            expect(createRes.status).toBe(201)
            const { channel } = await createRes.json() as any
            expect(channel.name).toBe('engineering')
            expect(channel.description).toBe('Engineering team')
            expect(channel.createdBy).toBe('alice')
            expect(typeof channel.id).toBe('string')
            const channelId: string = channel.id

            // -- read back --
            const getRes = await app.request(`/api/channels/${channelId}`)
            expect(getRes.status).toBe(200)
            const { channel: fetched } = await getRes.json() as any
            expect(fetched.id).toBe(channelId)
            expect(fetched.name).toBe('engineering')

            // -- update --
            const updateRes = await jsonRequest(app, 'PUT', `/api/channels/${channelId}`, {
                description: 'Updated description'
            })
            expect(updateRes.status).toBe(200)
            const { channel: updated } = await updateRes.json() as any
            expect(updated.description).toBe('Updated description')
            expect(updated.name).toBe('engineering') // unchanged

            // -- add member --
            const addRes = await jsonRequest(app, 'POST', `/api/channels/${channelId}/members`, {
                userId: 'bob', role: 'member'
            })
            expect(addRes.status).toBe(200)

            // -- verify members --
            const membersRes = await app.request(`/api/channels/${channelId}/members`)
            expect(membersRes.status).toBe(200)
            const { members } = await membersRes.json() as any
            expect(members).toHaveLength(2)
            expect(members.map((m: any) => m.userId).sort()).toEqual(['alice', 'bob'])

            // -- send 5 messages --
            for (let i = 1; i <= 5; i++) {
                const msgRes = await jsonRequest(app, 'POST', `/api/channels/${channelId}/messages`, {
                    body: { text: `Message ${i}` }
                })
                expect(msgRes.status).toBe(201)
            }

            // -- list all messages --
            const allRes = await app.request(`/api/channels/${channelId}/messages`)
            expect(allRes.status).toBe(200)
            const { messages: allMsgs } = await allRes.json() as any
            expect(allMsgs).toHaveLength(5)
            for (let i = 0; i < 5; i++) {
                expect(allMsgs[i].seq).toBe(i + 1)
                expect(allMsgs[i].body.text).toBe(`Message ${i + 1}`)
                expect(allMsgs[i].authorUserId).toBe('alice')
                expect(allMsgs[i].kind).toBe('text')
            }

            // -- paginate: before seq 5, limit 2 => seqs 3, 4 --
            const pageRes = await app.request(`/api/channels/${channelId}/messages?before=5&limit=2`)
            expect(pageRes.status).toBe(200)
            const { messages: page } = await pageRes.json() as any
            expect(page).toHaveLength(2)
            expect(page[0].seq).toBe(3)
            expect(page[1].seq).toBe(4)

            // -- remove member --
            const rmRes = await app.request(`/api/channels/${channelId}/members/bob`, { method: 'DELETE' })
            expect(rmRes.status).toBe(200)

            const membersAfter = await app.request(`/api/channels/${channelId}/members`)
            const { members: remaining } = await membersAfter.json() as any
            expect(remaining).toHaveLength(1)
            expect(remaining[0].userId).toBe('alice')

            // -- delete channel --
            const delRes = await app.request(`/api/channels/${channelId}`, { method: 'DELETE' })
            expect(delRes.status).toBe(200)
            expect((await delRes.json() as any).ok).toBe(true)

            // -- verify gone --
            const goneRes = await app.request(`/api/channels/${channelId}`)
            expect(goneRes.status).toBe(404)
        })
    })

    // ------------------------------------------------------------------
    // 2. Workspace defaults via auth flow
    // ------------------------------------------------------------------
    describe('workspace defaults via auth flow', () => {
        it('ensureDefaults creates #general and a personal channel, both visible via GET /api/channels', async () => {
            const { app } = createTestEnv('alice')

            const res = await jsonRequest(app, 'POST', '/api/workspace/ensure-defaults', {
                displayName: 'Alice'
            })
            expect(res.status).toBe(200)
            const data = await res.json() as any
            expect(data.generalChannel.name).toBe('general')
            expect(data.personalChannel.name).toBe("Alice's space")

            // Both channels should appear in the user's channel list
            const listRes = await app.request('/api/channels')
            expect(listRes.status).toBe(200)
            const { channels } = await listRes.json() as any
            expect(channels).toHaveLength(2)
            const names = channels.map((ch: any) => ch.name).sort()
            expect(names).toEqual(["Alice's space", 'general'])
        })

        it('ensureDefaults is idempotent', async () => {
            const { app } = createTestEnv('alice')

            const r1 = await jsonRequest(app, 'POST', '/api/workspace/ensure-defaults', { displayName: 'Alice' })
            const d1 = await r1.json() as any

            const r2 = await jsonRequest(app, 'POST', '/api/workspace/ensure-defaults', { displayName: 'Alice' })
            const d2 = await r2.json() as any

            expect(d1.generalChannel.id).toBe(d2.generalChannel.id)
            expect(d1.personalChannel.id).toBe(d2.personalChannel.id)

            // Only 2 channels total, not 4
            const listRes = await app.request('/api/channels')
            const { channels } = await listRes.json() as any
            expect(channels).toHaveLength(2)
        })

        it('two users share the same #general channel but have separate personal channels', async () => {
            const { app } = createTestEnv('alice')

            const r1 = await jsonRequest(app, 'POST', '/api/workspace/ensure-defaults', { displayName: 'Alice' })
            const d1 = await r1.json() as any

            const r2 = await jsonRequest(app, 'POST', '/api/workspace/ensure-defaults',
                { displayName: 'Bob' },
                { 'x-test-user-id': 'bob' }
            )
            const d2 = await r2.json() as any

            // Same #general
            expect(d1.generalChannel.id).toBe(d2.generalChannel.id)

            // Different personal channels
            expect(d1.personalChannel.id).not.toBe(d2.personalChannel.id)
            expect(d1.personalChannel.name).toBe("Alice's space")
            expect(d2.personalChannel.name).toBe("Bob's space")

            // Alice sees general + her personal + Bob's personal is NOT visible to her
            // (Alice is a member of general and her personal; Bob's personal has Bob as member)
            const aliceList = await app.request('/api/channels')
            const { channels: aliceChannels } = await aliceList.json() as any
            // Alice is member of: general (added by her ensureDefaults), Alice's space
            // Bob's ensureDefaults also adds Bob to general, but Alice was already a member
            // Alice is NOT added to Bob's personal channel
            expect(aliceChannels).toHaveLength(2)
            const aliceNames = aliceChannels.map((ch: any) => ch.name).sort()
            expect(aliceNames).toEqual(["Alice's space", 'general'])
        })
    })

    // ------------------------------------------------------------------
    // 3. Channel message seq integrity
    // ------------------------------------------------------------------
    describe('channel message seq integrity', () => {
        it('messages get monotonically increasing seq starting from 1', async () => {
            const { app } = createTestEnv('alice')

            const cr = await jsonRequest(app, 'POST', '/api/channels', { name: 'seq-test' })
            const { channel } = await cr.json() as any

            const seqs: number[] = []
            for (let i = 0; i < 10; i++) {
                const r = await jsonRequest(app, 'POST', `/api/channels/${channel.id}/messages`, {
                    body: { n: i }
                })
                expect(r.status).toBe(201)
                const { message } = await r.json() as any
                seqs.push(message.seq)
            }

            expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        })

        it('cursor pagination walks backwards correctly', async () => {
            const { app } = createTestEnv('alice')

            const cr = await jsonRequest(app, 'POST', '/api/channels', { name: 'page-test' })
            const { channel } = await cr.json() as any

            for (let i = 1; i <= 8; i++) {
                await jsonRequest(app, 'POST', `/api/channels/${channel.id}/messages`, { body: { i } })
            }

            // before=7, limit=3 => seqs [4, 5, 6]
            const p1 = await app.request(`/api/channels/${channel.id}/messages?before=7&limit=3`)
            const { messages: m1 } = await p1.json() as any
            expect(m1.map((m: any) => m.seq)).toEqual([4, 5, 6])

            // before=4, limit=10 => seqs [1, 2, 3]
            const p2 = await app.request(`/api/channels/${channel.id}/messages?before=4&limit=10`)
            const { messages: m2 } = await p2.json() as any
            expect(m2.map((m: any) => m.seq)).toEqual([1, 2, 3])

            // before=1 => empty
            const p3 = await app.request(`/api/channels/${channel.id}/messages?before=1&limit=10`)
            const { messages: m3 } = await p3.json() as any
            expect(m3).toHaveLength(0)
        })

        it('default limit caps the result set at 50', async () => {
            const { app, store } = createTestEnv('alice')

            const cr = await jsonRequest(app, 'POST', '/api/channels', { name: 'bulk' })
            const { channel } = await cr.json() as any

            // Insert 60 messages directly via store for speed
            for (let i = 0; i < 60; i++) {
                store.channelMessages.addMessage(channel.id, 'default', 'alice', 'text', { n: i + 1 })
            }

            const res = await app.request(`/api/channels/${channel.id}/messages`)
            const { messages } = await res.json() as any
            expect(messages).toHaveLength(50)
            // getMessages returns the LAST 50 in ascending order
            expect(messages[0].seq).toBe(11)
            expect(messages[49].seq).toBe(60)
        })

        it('each message gets a unique id', async () => {
            const { app } = createTestEnv('alice')

            const cr = await jsonRequest(app, 'POST', '/api/channels', { name: 'unique-ids' })
            const { channel } = await cr.json() as any

            const ids = new Set<string>()
            for (let i = 0; i < 5; i++) {
                const r = await jsonRequest(app, 'POST', `/api/channels/${channel.id}/messages`, {
                    body: { i }
                })
                const { message } = await r.json() as any
                ids.add(message.id)
            }
            expect(ids.size).toBe(5)
        })
    })

    // ------------------------------------------------------------------
    // 4. Membership-based visibility
    // ------------------------------------------------------------------
    describe('membership-based visibility', () => {
        it('non-member cannot list a channel they are not in', async () => {
            const { app } = createTestEnv('alice')

            await jsonRequest(app, 'POST', '/api/channels', { name: 'alice-only' })

            const bobList = await app.request('/api/channels', {
                headers: { 'x-test-user-id': 'bob' }
            })
            expect(bobList.status).toBe(200)
            const { channels } = await bobList.json() as any
            expect(channels).toHaveLength(0)
        })

        it('member can see channel after being added', async () => {
            const { app } = createTestEnv('alice')

            const cr = await jsonRequest(app, 'POST', '/api/channels', { name: 'shared' })
            const { channel } = await cr.json() as any

            await jsonRequest(app, 'POST', `/api/channels/${channel.id}/members`, {
                userId: 'bob'
            })

            const bobList = await app.request('/api/channels', {
                headers: { 'x-test-user-id': 'bob' }
            })
            const { channels } = await bobList.json() as any
            expect(channels).toHaveLength(1)
            expect(channels[0].id).toBe(channel.id)
        })

        it('non-member gets 403 on GET /channels/:id', async () => {
            const { app } = createTestEnv('alice')

            const cr = await jsonRequest(app, 'POST', '/api/channels', { name: 'secret' })
            const { channel } = await cr.json() as any

            const bobGet = await app.request(`/api/channels/${channel.id}`, {
                headers: { 'x-test-user-id': 'bob' }
            })
            expect(bobGet.status).toBe(403)
            const { error } = await bobGet.json() as any
            expect(error).toBe('Not a member of this channel')
        })

        it('non-member gets 403 on POST messages', async () => {
            const { app } = createTestEnv('alice')

            const cr = await jsonRequest(app, 'POST', '/api/channels', { name: 'guarded' })
            const { channel } = await cr.json() as any

            const bobMsg = await jsonRequest(
                app, 'POST', `/api/channels/${channel.id}/messages`,
                { body: { text: 'intruder' } },
                { 'x-test-user-id': 'bob' }
            )
            expect(bobMsg.status).toBe(403)
        })

        it('non-member gets 403 on GET messages', async () => {
            const { app } = createTestEnv('alice')

            const cr = await jsonRequest(app, 'POST', '/api/channels', { name: 'private-msgs' })
            const { channel } = await cr.json() as any

            await jsonRequest(app, 'POST', `/api/channels/${channel.id}/messages`, {
                body: { text: 'confidential' }
            })

            const bobRead = await app.request(`/api/channels/${channel.id}/messages`, {
                headers: { 'x-test-user-id': 'bob' }
            })
            expect(bobRead.status).toBe(403)
        })

        it('removed member loses access', async () => {
            const { app } = createTestEnv('alice')

            const cr = await jsonRequest(app, 'POST', '/api/channels', { name: 'revolving' })
            const { channel } = await cr.json() as any

            // Add Bob
            await jsonRequest(app, 'POST', `/api/channels/${channel.id}/members`, { userId: 'bob' })

            // Bob can see
            const bobOk = await app.request(`/api/channels/${channel.id}`, {
                headers: { 'x-test-user-id': 'bob' }
            })
            expect(bobOk.status).toBe(200)

            // Remove Bob
            await app.request(`/api/channels/${channel.id}/members/bob`, { method: 'DELETE' })

            // Bob is locked out
            const bobDenied = await app.request(`/api/channels/${channel.id}`, {
                headers: { 'x-test-user-id': 'bob' }
            })
            expect(bobDenied.status).toBe(403)
        })
    })

    // ------------------------------------------------------------------
    // 5. Channel-session linking
    // ------------------------------------------------------------------
    describe('channel-session linking', () => {
        it('sessions linked to a channel appear in GET /channels/:id/sessions', async () => {
            const { app, db } = createTestEnv('alice')

            const cr = await jsonRequest(app, 'POST', '/api/channels', { name: 'threads' })
            const { channel } = await cr.json() as any

            const sid1 = createSessionInChannel(db, 'default', channel.id, { title: 'Fix bug #42' })
            const sid2 = createSessionInChannel(db, 'default', channel.id, { title: 'Refactor auth' })

            const res = await app.request(`/api/channels/${channel.id}/sessions`)
            expect(res.status).toBe(200)
            const { sessions } = await res.json() as any
            expect(sessions).toHaveLength(2)
            const ids = sessions.map((s: any) => s.id).sort()
            expect(ids).toEqual([sid1, sid2].sort())
            // Verify thread metadata came through
            const titles = sessions.map((s: any) => s.threadTitle).sort()
            expect(titles).toEqual(['Fix bug #42', 'Refactor auth'])
        })

        it('detaching a specific session removes only that session', async () => {
            const { app, db } = createTestEnv('alice')

            const cr = await jsonRequest(app, 'POST', '/api/channels', { name: 'ops' })
            const { channel } = await cr.json() as any

            const sid1 = createSessionInChannel(db, 'default', channel.id, { title: 'Deploy' })
            const sid2 = createSessionInChannel(db, 'default', channel.id, { title: 'Monitor' })

            // Detach sid1 only
            const detach = await app.request(
                `/api/channels/${channel.id}/sessions/${sid1}/detach`,
                { method: 'POST' }
            )
            expect(detach.status).toBe(200)
            expect((await detach.json() as any).ok).toBe(true)

            const res = await app.request(`/api/channels/${channel.id}/sessions`)
            const { sessions } = await res.json() as any
            expect(sessions).toHaveLength(1)
            expect(sessions[0].id).toBe(sid2)
        })

        it('returns 400 when detaching a session that belongs to a different channel', async () => {
            const { app, db } = createTestEnv('alice')

            const c1r = await jsonRequest(app, 'POST', '/api/channels', { name: 'ch-a' })
            const c2r = await jsonRequest(app, 'POST', '/api/channels', { name: 'ch-b' })
            const { channel: chA } = await c1r.json() as any
            const { channel: chB } = await c2r.json() as any

            const sid = createSessionInChannel(db, 'default', chB.id)

            const res = await app.request(`/api/channels/${chA.id}/sessions/${sid}/detach`, { method: 'POST' })
            expect(res.status).toBe(400)
            const { error } = await res.json() as any
            expect(error).toBe('Session is not in this channel')
        })

        it('returns 404 when detaching a nonexistent session', async () => {
            const { app } = createTestEnv('alice')

            const cr = await jsonRequest(app, 'POST', '/api/channels', { name: 'empty-ch' })
            const { channel } = await cr.json() as any

            const res = await app.request(`/api/channels/${channel.id}/sessions/no-such-session/detach`, {
                method: 'POST'
            })
            expect(res.status).toBe(404)
            expect((await res.json() as any).error).toBe('Session not found')
        })

        it('deleting a channel with linked sessions detaches them first', async () => {
            const { app, db, store } = createTestEnv('alice')

            const cr = await jsonRequest(app, 'POST', '/api/channels', { name: 'doomed' })
            const { channel } = await cr.json() as any

            const sid = createSessionInChannel(db, 'default', channel.id, { title: 'Attached' })

            // Delete the channel (route detaches sessions before deleting)
            const delRes = await app.request(`/api/channels/${channel.id}`, { method: 'DELETE' })
            expect(delRes.status).toBe(200)

            // Session still exists but is no longer linked to a channel
            const session = store.sessions.getSession(sid)
            expect(session).not.toBeNull()
            expect(session!.channelId).toBeNull()
        })
    })

    // ------------------------------------------------------------------
    // 6. Personal channel protection
    // ------------------------------------------------------------------
    describe('personal channel protection', () => {
        it('DELETE on a personal channel returns 403', async () => {
            const { app } = createTestEnv('alice')

            const defaults = await jsonRequest(app, 'POST', '/api/workspace/ensure-defaults', {
                displayName: 'Alice'
            })
            const { personalChannel } = await defaults.json() as any

            const res = await app.request(`/api/channels/${personalChannel.id}`, { method: 'DELETE' })
            expect(res.status).toBe(403)
            const { error } = await res.json() as any
            expect(error).toBe('Cannot delete personal channel')

            // Verify it still exists
            const getRes = await app.request(`/api/channels/${personalChannel.id}`)
            expect(getRes.status).toBe(200)
        })

        it('DELETE on a regular channel succeeds', async () => {
            const { app } = createTestEnv('alice')

            const cr = await jsonRequest(app, 'POST', '/api/channels', { name: 'temp' })
            const { channel } = await cr.json() as any

            const res = await app.request(`/api/channels/${channel.id}`, { method: 'DELETE' })
            expect(res.status).toBe(200)

            const gone = await app.request(`/api/channels/${channel.id}`)
            expect(gone.status).toBe(404)
        })

        it('#general is not a personal channel and can be deleted', async () => {
            const { app } = createTestEnv('alice')

            const defaults = await jsonRequest(app, 'POST', '/api/workspace/ensure-defaults', {
                displayName: 'Alice'
            })
            const { generalChannel } = await defaults.json() as any

            // #general is not flagged as a personal channel
            const res = await app.request(`/api/channels/${generalChannel.id}`, { method: 'DELETE' })
            expect(res.status).toBe(200)
        })
    })

    // ------------------------------------------------------------------
    // 7. Error cases
    // ------------------------------------------------------------------
    describe('error cases', () => {
        it('GET nonexistent channel returns 404', async () => {
            const { app } = createTestEnv('alice')

            const res = await app.request(`/api/channels/${randomUUID()}`)
            expect(res.status).toBe(404)
            expect((await res.json() as any).error).toBe('Channel not found')
        })

        it('DELETE nonexistent channel returns 404', async () => {
            const { app } = createTestEnv('alice')

            const res = await app.request(`/api/channels/${randomUUID()}`, { method: 'DELETE' })
            expect(res.status).toBe(404)
        })

        it('POST messages to nonexistent channel returns 404', async () => {
            const { app } = createTestEnv('alice')

            const res = await jsonRequest(app, 'POST', `/api/channels/${randomUUID()}/messages`, {
                body: { text: 'hello' }
            })
            expect(res.status).toBe(404)
        })

        it('GET messages from nonexistent channel returns 404', async () => {
            const { app } = createTestEnv('alice')

            const res = await app.request(`/api/channels/${randomUUID()}/messages`)
            expect(res.status).toBe(404)
        })

        it('GET members of nonexistent channel returns 404', async () => {
            const { app } = createTestEnv('alice')

            const res = await app.request(`/api/channels/${randomUUID()}/members`)
            expect(res.status).toBe(404)
        })

        it('GET sessions of nonexistent channel returns 404', async () => {
            const { app } = createTestEnv('alice')

            const res = await app.request(`/api/channels/${randomUUID()}/sessions`)
            expect(res.status).toBe(404)
        })

        it('POST channel with missing name returns 400', async () => {
            const { app } = createTestEnv('alice')

            const res = await jsonRequest(app, 'POST', '/api/channels', { description: 'no name' })
            expect(res.status).toBe(400)
            expect((await res.json() as any).error).toBe('name is required')
        })

        it('POST ensure-defaults with missing displayName returns 400', async () => {
            const { app } = createTestEnv('alice')

            const res = await jsonRequest(app, 'POST', '/api/workspace/ensure-defaults', {})
            expect(res.status).toBe(400)
            expect((await res.json() as any).error).toBe('displayName is required')
        })

        it('namespace isolation: channel invisible from another namespace', async () => {
            const { app } = createTestEnv('alice')

            const cr = await jsonRequest(app, 'POST', '/api/channels', { name: 'scoped' })
            expect(cr.status).toBe(201)
            const { channel } = await cr.json() as any

            // Same channel id, different namespace => 404
            const cross = await app.request(`/api/channels/${channel.id}`, {
                headers: { 'x-test-namespace': 'other-ns', 'x-test-user-id': 'alice' }
            })
            expect(cross.status).toBe(404)
        })

        it('namespace isolation: channels list returns only matching namespace', async () => {
            const { app } = createTestEnv('alice')

            await jsonRequest(app, 'POST', '/api/channels', { name: 'ns-test' })

            const otherNs = await app.request('/api/channels', {
                headers: { 'x-test-namespace': 'other', 'x-test-user-id': 'alice' }
            })
            const { channels } = await otherNs.json() as any
            expect(channels).toHaveLength(0)
        })

        it('non-member cannot add members', async () => {
            const { app } = createTestEnv('alice')

            const cr = await jsonRequest(app, 'POST', '/api/channels', { name: 'restricted' })
            const { channel } = await cr.json() as any

            // Bob (non-member) tries to add carol
            const res = await jsonRequest(
                app, 'POST', `/api/channels/${channel.id}/members`,
                { userId: 'carol' },
                { 'x-test-user-id': 'bob' }
            )
            expect(res.status).toBe(403)
        })

        it('non-member cannot delete a channel', async () => {
            const { app } = createTestEnv('alice')

            const cr = await jsonRequest(app, 'POST', '/api/channels', { name: 'owned' })
            const { channel } = await cr.json() as any

            const res = await app.request(`/api/channels/${channel.id}`, {
                method: 'DELETE',
                headers: { 'x-test-user-id': 'bob' }
            })
            expect(res.status).toBe(403)
        })
    })
})
