import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store } from './index'
import { createChannelsRoutes } from '../web/routes/channels'
import type { WebAppEnv } from '../web/middleware/auth'

function createStoreSyncAdapter(store: Store) {
    return {
        getChannelsForUser: (ns: string, userId: string) => store.channels.getChannelsForUser(ns, userId),
        getChannel: (id: string, ns: string) => store.channels.getChannel(id, ns),
        getChannelById: (id: string) => store.channels.getChannelById(id),
        isChannelMember: (id: string, userId: string) => store.channels.isMember(id, userId),
        isPersonalChannel: (id: string) => store.workspaceUsers.isPersonalChannel(id),
        createChannel: (ns: string, name: string, createdBy: string, desc?: string, agentConfig?: unknown) =>
            store.channels.createChannel(ns, name, createdBy, desc, agentConfig),
        updateChannelData: (id: string, ns: string, updates: { name?: string; description?: string | null; agentConfig?: unknown | null }) =>
            store.channels.updateChannel(id, ns, updates),
        deleteChannel: (id: string, ns: string) => {
            store.sessions.detachSessionsFromChannel(id, ns)
            return store.channels.deleteChannel(id, ns)
        },
        addChannelMember: (id: string, userId: string, role: string) => store.channels.addMember(id, userId, role),
        removeChannelMember: (id: string, userId: string) => store.channels.removeMember(id, userId),
        getChannelMembers: (id: string) => store.channels.getMembers(id),
        sendChannelMessage: (channelId: string, ns: string, authorUserId: string | null, kind: string, body: unknown, threadSessionId?: string) =>
            store.channelMessages.addMessage(channelId, ns, authorUserId, kind, body, threadSessionId),
        getChannelMessages: (channelId: string, opts?: { before?: number; limit?: number }) =>
            store.channelMessages.getMessages(channelId, opts),
        getSessionsByChannel: (channelId: string, ns: string) => store.sessions.getSessionsByChannel(channelId, ns),
        getSessionByNamespace: (sessionId: string, ns: string) => store.sessions.getSessionByNamespace(sessionId, ns),
        detachSession: (sessionId: string, channelId: string, ns: string) => store.sessions.detachSession(sessionId, channelId, ns),
        ensureWorkspaceDefaults: (ns: string, userId: string, displayName: string) =>
            store.workspaceUsers.ensureDefaults(ns, userId, displayName),
        createChannelInvite: (channelId: string, ns: string, createdBy: string) => {
            const invite = store.channelInvites.createInvite(channelId, ns, createdBy)
            return { id: invite.id, expiresAt: invite.expiresAt }
        },
        acceptChannelInvite: (inviteId: string, userId: string, requesterNamespace: string) => {
            const invite = store.channelInvites.getInvite(inviteId)
            if (!invite || invite.expiresAt < Date.now()) return null
            void requesterNamespace
            store.channels.addMember(invite.channelId, userId, 'member')
            return { channelId: invite.channelId, namespace: invite.namespace }
        },
        createThreadInChannel: (channelId: string, ns: string, userId: string, threadTitle: string, metadata?: unknown) => {
            const tag = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            return store.sessions.getOrCreateSession(tag, metadata ?? { path: '/' }, null, ns, undefined, undefined, undefined, {
                channelId, threadTitle, createdByUserId: userId
            })
        },
        updateThreadStatus: (sessionId: string, ns: string, status: 'active' | 'completed' | 'archived') =>
            store.sessions.setThreadStatus(sessionId, ns, status),
        getWorkspaceUser: (ns: string, userId: string) =>
            store.workspaceUsers.getUser(ns, userId),
        getDisplayNameForUser: (userId: string) =>
            store.workspaceUsers.getUserGlobal(userId)?.displayName ?? null,
        getReactionsForMessages: (messageIds: string[]) =>
            store.channelMessageReactions.getForMessages(messageIds),
        toggleMessageReaction: (messageId: string, _channelId: string, _ns: string, reactorRef: string, emoji: string) =>
            store.channelMessageReactions.toggle(messageId, reactorRef, emoji),
        removeMessageReaction: (messageId: string, _channelId: string, _ns: string, reactorRef: string, emoji: string) =>
            store.channelMessageReactions.remove(messageId, reactorRef, emoji),
        // Stage 2: + New thread route requires this. Tests don't exercise the
        // bot path here; just stub a no-op accepting result.
        requestNewThread: (_channelId: string, _ns: string, _userId: string, _topic: string) => true
    }
}

// ---------------------------------------------------------------------------
// Area 1 — Concurrent seq allocation
// ---------------------------------------------------------------------------

describe('concurrent seq allocation', () => {
    function setupStore(): { store: Store; channelId: string } {
        const store = new Store(':memory:')
        const ch = store.channels.createChannel('ns1', 'concurrency-test', 'user-1')
        return { store, channelId: ch.id }
    }

    async function fireConcurrentMessages(store: Store, channelId: string, n: number) {
        const promises = Array.from({ length: n }, (_, i) =>
            Promise.resolve().then(() =>
                store.channelMessages.addMessage(
                    channelId,
                    'ns1',
                    `user-${i}`,
                    'text',
                    { index: i }
                )
            )
        )
        return Promise.all(promises)
    }

    it('N=10: all seq values are unique and contiguous [1..N]', async () => {
        const { store, channelId } = setupStore()
        const messages = await fireConcurrentMessages(store, channelId, 10)

        const seqs = messages.map((m) => m.seq).sort((a, b) => a - b)
        expect(seqs).toEqual(Array.from({ length: 10 }, (_, i) => i + 1))
    })

    it('N=50: all seq values are unique and contiguous [1..N]', async () => {
        const { store, channelId } = setupStore()
        const messages = await fireConcurrentMessages(store, channelId, 50)

        const seqs = messages.map((m) => m.seq).sort((a, b) => a - b)
        expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))

        // Also verify no duplicates via Set
        expect(new Set(seqs).size).toBe(50)
    })

    it('N=100: all seq values are unique and contiguous [1..N]', async () => {
        const { store, channelId } = setupStore()
        const messages = await fireConcurrentMessages(store, channelId, 100)

        const seqs = messages.map((m) => m.seq).sort((a, b) => a - b)
        expect(seqs).toEqual(Array.from({ length: 100 }, (_, i) => i + 1))
        expect(new Set(seqs).size).toBe(100)
    })

    it('UNIQUE(channel_id, seq) constraint exists and would catch duplicates', () => {
        // Verify the constraint by attempting a raw duplicate insert
        const store = new Store(':memory:')
        const ch = store.channels.createChannel('ns1', 'constraint-test', 'user-1')
        store.channelMessages.addMessage(ch.id, 'ns1', 'user-1', 'text', { n: 1 })

        // Access the raw db to attempt a duplicate seq insert
        const db = (store as any).db
        expect(() => {
            db.prepare(`
                INSERT INTO channel_messages (id, channel_id, namespace, author_user_id, kind, body, created_at, seq)
                VALUES ('dup-id', @cid, 'ns1', 'user-1', 'text', '"dup"', ${Date.now()}, 1)
            `).run({ cid: ch.id })
        }).toThrow() // UNIQUE constraint violation
    })

    it('maxSeq matches N after concurrent writes', async () => {
        const { store, channelId } = setupStore()
        await fireConcurrentMessages(store, channelId, 25)
        expect(store.channelMessages.getMaxSeq(channelId)).toBe(25)
    })

    it('concurrent writes to different channels do not interfere', async () => {
        const store = new Store(':memory:')
        const ch1 = store.channels.createChannel('ns1', 'chan-a', 'user-1')
        const ch2 = store.channels.createChannel('ns1', 'chan-b', 'user-1')

        const [msgs1, msgs2] = await Promise.all([
            fireConcurrentMessages(store, ch1.id, 20),
            fireConcurrentMessages(store, ch2.id, 20)
        ])

        const seqs1 = msgs1.map((m) => m.seq).sort((a, b) => a - b)
        const seqs2 = msgs2.map((m) => m.seq).sort((a, b) => a - b)

        // Each channel independently gets [1..20]
        expect(seqs1).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
        expect(seqs2).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    })

    // NOTE ON CONCURRENCY MODEL:
    // Bun's SQLite driver executes statements synchronously on the main thread.
    // Promise.all dispatches all calls onto the microtask queue, but each
    // addMessage transaction (BEGIN / UPDATE RETURNING / INSERT / COMMIT) runs
    // atomically because the JS event loop cannot interleave synchronous C calls.
    // This means true data-race conditions cannot occur in-process with bun:sqlite.
    // The tests above confirm correctness under the microtask-scheduling model and
    // validate the UNIQUE(channel_id, seq) constraint as a safety net.
})

// ---------------------------------------------------------------------------
// Area 2 — Input boundary / edge cases (route-level via Hono app.request)
// ---------------------------------------------------------------------------

describe('input boundary edge cases', () => {
    // Helper: build a Hono app with test auth middleware injecting namespace/userId
    function buildApp(store: Store): Hono<WebAppEnv> {
        const app = new Hono<WebAppEnv>()
        // Test auth middleware — sets namespace and userId without JWT
        app.use('*', async (c, next) => {
            c.set('namespace', 'test-ns')
            c.set('userId', 42 as any) // routes call String(c.get('userId'))
            await next()
        })
        const adapter = createStoreSyncAdapter(store)
        app.route('/', createChannelsRoutes(() => adapter as any))
        return app
    }

    // Helper: create a store with a channel and make the test user a member
    function setupStoreWithChannel(): { store: Store; channelId: string } {
        const store = new Store(':memory:')
        const ch = store.channels.createChannel('test-ns', 'test-channel', '42')
        store.channels.addMember(ch.id, '42', 'owner')
        return { store, channelId: ch.id }
    }

    // -----------------------------------------------------------------------
    // Query parameter validation
    // -----------------------------------------------------------------------

    describe('query parameter validation on GET /channels/:id/messages', () => {
        it('before=abc returns 400', async () => {
            const { store, channelId } = setupStoreWithChannel()
            const app = buildApp(store)
            const res = await app.request(`/channels/${channelId}/messages?before=abc`)
            expect(res.status).toBe(400)
            const json = (await res.json()) as { error: string }
            expect(json.error).toContain('before')
        })

        it('limit=abc returns 400', async () => {
            const { store, channelId } = setupStoreWithChannel()
            const app = buildApp(store)
            const res = await app.request(`/channels/${channelId}/messages?limit=abc`)
            expect(res.status).toBe(400)
            const json = (await res.json()) as { error: string }
            expect(json.error).toContain('limit')
        })

        it('before=-1 returns 200 (store handles negative values)', async () => {
            const { store, channelId } = setupStoreWithChannel()
            const app = buildApp(store)
            const res = await app.request(`/channels/${channelId}/messages?before=-1`)
            expect(res.status).toBe(200)
            const json = (await res.json()) as { messages: unknown[] }
            expect(json.messages).toEqual([]) // no messages with seq < -1
        })

        it('limit=0 returns 200 (store clamps to min 1)', async () => {
            const { store, channelId } = setupStoreWithChannel()
            const app = buildApp(store)
            // Add a message so there is something to return
            store.channelMessages.addMessage(channelId, 'test-ns', '42', 'text', { t: 1 })
            const res = await app.request(`/channels/${channelId}/messages?limit=0`)
            expect(res.status).toBe(200)
            const json = (await res.json()) as { messages: unknown[] }
            // limit=0 is clamped to 1, so we should get at least 1 message
            expect(json.messages.length).toBeGreaterThanOrEqual(1)
        })

        it('limit=999 returns 200 (store clamps to max 200)', async () => {
            const { store, channelId } = setupStoreWithChannel()
            const app = buildApp(store)
            const res = await app.request(`/channels/${channelId}/messages?limit=999`)
            expect(res.status).toBe(200)
        })
    })

    // -----------------------------------------------------------------------
    // Missing / malformed request bodies
    // -----------------------------------------------------------------------

    describe('missing/malformed request bodies', () => {
        it('POST /channels with empty body {} returns 400 (name required)', async () => {
            const store = new Store(':memory:')
            const app = buildApp(store)
            const res = await app.request('/channels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            })
            expect(res.status).toBe(400)
            const json = (await res.json()) as { error: string }
            expect(json.error).toContain('name')
        })

        it('POST /channels with { name: 123 } returns 400 (not a string)', async () => {
            const store = new Store(':memory:')
            const app = buildApp(store)
            const res = await app.request('/channels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 123 })
            })
            expect(res.status).toBe(400)
            const json = (await res.json()) as { error: string }
            expect(json.error).toContain('name')
        })

        it('POST /channels with { name: "" } returns 400 (empty string)', async () => {
            const store = new Store(':memory:')
            const app = buildApp(store)
            const res = await app.request('/channels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: '' })
            })
            expect(res.status).toBe(400)
            const json = (await res.json()) as { error: string }
            expect(json.error).toContain('name')
        })

        it('POST /channels/:id/messages with {} (missing body field) returns 400', async () => {
            const { store, channelId } = setupStoreWithChannel()
            const app = buildApp(store)
            const res = await app.request(`/channels/${channelId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            })
            expect(res.status).toBe(400)
            const json = (await res.json()) as { error: string }
            expect(json.error).toContain('body')
        })

        it('POST /workspace/ensure-defaults with {} returns 400', async () => {
            const store = new Store(':memory:')
            const app = buildApp(store)
            const res = await app.request('/workspace/ensure-defaults', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            })
            expect(res.status).toBe(400)
            const json = (await res.json()) as { error: string }
            expect(json.error).toContain('displayName')
        })

        it('POST /workspace/ensure-defaults with { displayName: 123 } returns 400', async () => {
            const store = new Store(':memory:')
            const app = buildApp(store)
            const res = await app.request('/workspace/ensure-defaults', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ displayName: 123 })
            })
            expect(res.status).toBe(400)
            const json = (await res.json()) as { error: string }
            expect(json.error).toContain('displayName')
        })
    })

    // -----------------------------------------------------------------------
    // String edge cases
    // -----------------------------------------------------------------------

    describe('string edge cases', () => {
        it('channel name with XSS payload is stored as-is (no sanitization at DB layer)', async () => {
            const store = new Store(':memory:')
            const app = buildApp(store)
            const xssName = 'test<script>alert(1)</script>'
            const res = await app.request('/channels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: xssName })
            })
            expect(res.status).toBe(201)
            const json = (await res.json()) as { channel: { name: string } }
            expect(json.channel.name).toBe(xssName)
        })

        it('very long channel name (10000 chars) does not crash', async () => {
            const store = new Store(':memory:')
            const app = buildApp(store)
            const longName = 'a'.repeat(10000)
            const res = await app.request('/channels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: longName })
            })
            expect(res.status).toBe(201)
            const json = (await res.json()) as { channel: { name: string } }
            expect(json.channel.name).toBe(longName)
        })

        it('channel name with SQL injection attempt is safely parameterized', async () => {
            const store = new Store(':memory:')
            const app = buildApp(store)
            const sqlInjection = "'; DROP TABLE channels; --"
            const res = await app.request('/channels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: sqlInjection })
            })
            expect(res.status).toBe(201)
            const json = (await res.json()) as { channel: { name: string } }
            expect(json.channel.name).toBe(sqlInjection)

            // Verify channels table still exists and works
            const listRes = await app.request('/channels')
            expect(listRes.status).toBe(200)
        })

        it('empty string userId in member add returns 400', async () => {
            const { store, channelId } = setupStoreWithChannel()
            const app = buildApp(store)
            const res = await app.request(`/channels/${channelId}/members`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: '' })
            })
            expect(res.status).toBe(400)
            const json = (await res.json()) as { error: string }
            expect(json.error).toContain('userId')
        })

        it('channel name with unicode and emoji characters stores correctly', async () => {
            const store = new Store(':memory:')
            const app = buildApp(store)
            const unicodeName = '备\u{1F680}rocket-channel-éèê'
            const res = await app.request('/channels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: unicodeName })
            })
            expect(res.status).toBe(201)
            const json = (await res.json()) as { channel: { name: string } }
            expect(json.channel.name).toBe(unicodeName)
        })

        it('channel name with newlines and tabs stores correctly', async () => {
            const store = new Store(':memory:')
            const app = buildApp(store)
            const weirdName = 'line1\nline2\ttab'
            const res = await app.request('/channels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: weirdName })
            })
            expect(res.status).toBe(201)
            const json = (await res.json()) as { channel: { name: string } }
            expect(json.channel.name).toBe(weirdName)
        })
    })

    // -----------------------------------------------------------------------
    // Seq edge cases at the store level
    // -----------------------------------------------------------------------

    describe('seq edge cases at the store level', () => {
        it('getMessages with before=0 returns empty (no seq < 0)', () => {
            const store = new Store(':memory:')
            const ch = store.channels.createChannel('test-ns', 'seq-test', '42')
            for (let i = 0; i < 5; i++) {
                store.channelMessages.addMessage(ch.id, 'test-ns', '42', 'text', { i })
            }
            const msgs = store.channelMessages.getMessages(ch.id, { before: 0 })
            expect(msgs).toEqual([])
        })

        it('getMessages with limit=201 clamps to 200', () => {
            const store = new Store(':memory:')
            const ch = store.channels.createChannel('test-ns', 'limit-test', '42')
            // Insert 210 messages
            for (let i = 0; i < 210; i++) {
                store.channelMessages.addMessage(ch.id, 'test-ns', '42', 'text', { i })
            }
            const msgs = store.channelMessages.getMessages(ch.id, { limit: 201 })
            expect(msgs).toHaveLength(200)
        })

        it('getMessagesSince with afterSeq far beyond max returns empty', () => {
            const store = new Store(':memory:')
            const ch = store.channels.createChannel('test-ns', 'since-test', '42')
            for (let i = 0; i < 5; i++) {
                store.channelMessages.addMessage(ch.id, 'test-ns', '42', 'text', { i })
            }
            const msgs = store.channelMessages.getMessagesSince(ch.id, 999999)
            expect(msgs).toEqual([])
        })

        it('getMessagesSince with afterSeq=0 returns all messages (up to limit)', () => {
            const store = new Store(':memory:')
            const ch = store.channels.createChannel('test-ns', 'since-zero-test', '42')
            for (let i = 0; i < 5; i++) {
                store.channelMessages.addMessage(ch.id, 'test-ns', '42', 'text', { i })
            }
            const msgs = store.channelMessages.getMessagesSince(ch.id, 0)
            expect(msgs).toHaveLength(5)
            expect(msgs[0].seq).toBe(1)
            expect(msgs[4].seq).toBe(5)
        })

        it('getMessages with limit=-1 clamps to 1', () => {
            const store = new Store(':memory:')
            const ch = store.channels.createChannel('test-ns', 'neg-limit-test', '42')
            for (let i = 0; i < 3; i++) {
                store.channelMessages.addMessage(ch.id, 'test-ns', '42', 'text', { i })
            }
            const msgs = store.channelMessages.getMessages(ch.id, { limit: -1 })
            expect(msgs).toHaveLength(1)
        })

        it('getMessagesSince with limit=0 clamps to 1', () => {
            const store = new Store(':memory:')
            const ch = store.channels.createChannel('test-ns', 'since-zero-limit', '42')
            for (let i = 0; i < 3; i++) {
                store.channelMessages.addMessage(ch.id, 'test-ns', '42', 'text', { i })
            }
            const msgs = store.channelMessages.getMessagesSince(ch.id, 0, 0)
            expect(msgs).toHaveLength(1)
        })

        it('getMaxSeq on channel with no messages returns 0', () => {
            const store = new Store(':memory:')
            const ch = store.channels.createChannel('test-ns', 'empty-ch', '42')
            expect(store.channelMessages.getMaxSeq(ch.id)).toBe(0)
        })

        it('getMaxSeq on nonexistent channel returns 0', () => {
            const store = new Store(':memory:')
            expect(store.channelMessages.getMaxSeq('nonexistent-channel-id')).toBe(0)
        })
    })

    // -----------------------------------------------------------------------
    // 404/403 edge cases
    // -----------------------------------------------------------------------

    describe('nonexistent channel returns 404', () => {
        it('GET /channels/:id with bad id returns 404', async () => {
            const store = new Store(':memory:')
            const app = buildApp(store)
            const res = await app.request('/channels/does-not-exist')
            expect(res.status).toBe(404)
        })

        it('GET /channels/:id/messages with bad id returns 404', async () => {
            const store = new Store(':memory:')
            const app = buildApp(store)
            const res = await app.request('/channels/does-not-exist/messages')
            expect(res.status).toBe(404)
        })

        it('POST /channels/:id/messages with bad id returns 404', async () => {
            const store = new Store(':memory:')
            const app = buildApp(store)
            const res = await app.request('/channels/does-not-exist/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body: 'hello' })
            })
            expect(res.status).toBe(404)
        })
    })

    describe('non-member returns 403', () => {
        it('GET /channels/:id returns 403 for non-member', async () => {
            const store = new Store(':memory:')
            // Create channel but do NOT add userId '42' as member
            const ch = store.channels.createChannel('test-ns', 'private', 'other-user')
            const app = buildApp(store)
            const res = await app.request(`/channels/${ch.id}`)
            expect(res.status).toBe(403)
        })
    })
})
