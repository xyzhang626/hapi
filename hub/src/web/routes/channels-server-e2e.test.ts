import { describe, expect, it, beforeAll, afterAll } from 'bun:test'
import { Hono } from 'hono'
import { SignJWT, jwtVerify } from 'jose'
import { Store } from '../../store'
import type { StoredChannel, StoredChannelMember, StoredChannelMessage } from '../../store/types'
import { createChannelsRoutes } from './channels'
import type { WebAppEnv } from '../middleware/auth'

const JWT_SECRET = new TextEncoder().encode('test-secret-key-for-server-e2e')

function createStoreSyncAdapter(store: Store) {
    return {
        getChannelsForUser: (ns: string, userId: string) => store.channels.getChannelsForUser(ns, userId),
        getChannel: (id: string, ns: string) => store.channels.getChannel(id, ns),
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
            if (!invite || invite.expiresAt < Date.now() || invite.namespace !== requesterNamespace) return null
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
            store.sessions.setThreadStatus(sessionId, ns, status)
    }
}

function createServer() {
    const store = new Store(':memory:')
    const adapter = createStoreSyncAdapter(store)
    const app = new Hono<WebAppEnv>()

    app.use('/api/*', async (c, next) => {
        const auth = c.req.header('Authorization')
        if (!auth?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)
        const token = auth.slice(7)
        try {
            const { payload } = await jwtVerify(token, JWT_SECRET, { algorithms: ['HS256'] })
            c.set('userId', payload.uid as number)
            c.set('namespace', payload.ns as string)
            await next()
        } catch {
            return c.json({ error: 'Invalid token' }, 401)
        }
    })

    app.route('/api', createChannelsRoutes(() => adapter as any))

    const server = Bun.serve({ port: 0, fetch: app.fetch })
    return { server, store, baseUrl: `http://localhost:${server.port}` }
}

async function getToken(uid: number, ns: string): Promise<string> {
    return new SignJWT({ uid, ns })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('1h')
        .sign(JWT_SECRET)
}

async function getExpiredToken(uid: number, ns: string): Promise<string> {
    return new SignJWT({ uid, ns })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('-1h')
        .sign(JWT_SECRET)
}

function authHeaders(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

describe('channels server E2E (real HTTP)', () => {
    let server: ReturnType<typeof createServer>['server']
    let store: Store
    let baseUrl: string
    let aliceToken: string
    let bobToken: string

    beforeAll(async () => {
        const s = createServer()
        server = s.server
        store = s.store
        baseUrl = s.baseUrl
        aliceToken = await getToken(1, 'test-ns')
        bobToken = await getToken(2, 'test-ns')
    })

    afterAll(() => {
        server.stop(true)
    })

    // ------------------------------------------------------------------
    // 1. Real JWT auth
    // ------------------------------------------------------------------
    describe('JWT auth', () => {
        it('missing token returns 401', async () => {
            const res = await fetch(`${baseUrl}/api/channels`)
            expect(res.status).toBe(401)
        })

        it('invalid token returns 401', async () => {
            const res = await fetch(`${baseUrl}/api/channels`, {
                headers: { Authorization: 'Bearer not-a-real-jwt' }
            })
            expect(res.status).toBe(401)
        })

        it('expired token returns 401', async () => {
            const expired = await getExpiredToken(1, 'test-ns')
            const res = await fetch(`${baseUrl}/api/channels`, {
                headers: { Authorization: `Bearer ${expired}` }
            })
            expect(res.status).toBe(401)
        })

        it('valid token returns 200', async () => {
            const res = await fetch(`${baseUrl}/api/channels`, {
                headers: { Authorization: `Bearer ${aliceToken}` }
            })
            expect(res.status).toBe(200)
            const data = await res.json() as any
            expect(data.channels).toBeArray()
        })
    })

    // ------------------------------------------------------------------
    // 2. Full channel lifecycle through real HTTP
    // ------------------------------------------------------------------
    describe('full channel lifecycle', () => {
        it('create -> get -> update -> messages -> pagination -> delete', async () => {
            // Create
            const createRes = await fetch(`${baseUrl}/api/channels`, {
                method: 'POST',
                headers: authHeaders(aliceToken),
                body: JSON.stringify({ name: 'engineering', description: 'Eng team' })
            })
            expect(createRes.status).toBe(201)
            const { channel } = await createRes.json() as any
            expect(channel.name).toBe('engineering')
            expect(channel.description).toBe('Eng team')
            const channelId: string = channel.id

            // Get
            const getRes = await fetch(`${baseUrl}/api/channels/${channelId}`, {
                headers: authHeaders(aliceToken)
            })
            expect(getRes.status).toBe(200)
            const { channel: fetched } = await getRes.json() as any
            expect(fetched.id).toBe(channelId)

            // Update
            const updateRes = await fetch(`${baseUrl}/api/channels/${channelId}`, {
                method: 'PUT',
                headers: authHeaders(aliceToken),
                body: JSON.stringify({ description: 'Updated desc' })
            })
            expect(updateRes.status).toBe(200)
            const { channel: updated } = await updateRes.json() as any
            expect(updated.description).toBe('Updated desc')
            expect(updated.name).toBe('engineering')

            // Send 5 messages
            for (let i = 1; i <= 5; i++) {
                const msgRes = await fetch(`${baseUrl}/api/channels/${channelId}/messages`, {
                    method: 'POST',
                    headers: authHeaders(aliceToken),
                    body: JSON.stringify({ body: { text: `Message ${i}` } })
                })
                expect(msgRes.status).toBe(201)
            }

            // List all messages
            const allRes = await fetch(`${baseUrl}/api/channels/${channelId}/messages`, {
                headers: authHeaders(aliceToken)
            })
            expect(allRes.status).toBe(200)
            const { messages: allMsgs } = await allRes.json() as any
            expect(allMsgs).toHaveLength(5)
            expect(allMsgs[0].body.text).toBe('Message 1')
            expect(allMsgs[4].body.text).toBe('Message 5')

            // Paginate: before seq 5, limit 2 => seqs 3, 4
            const pageRes = await fetch(`${baseUrl}/api/channels/${channelId}/messages?before=5&limit=2`, {
                headers: authHeaders(aliceToken)
            })
            expect(pageRes.status).toBe(200)
            const { messages: page } = await pageRes.json() as any
            expect(page).toHaveLength(2)
            expect(page[0].seq).toBe(3)
            expect(page[1].seq).toBe(4)

            // Delete
            const delRes = await fetch(`${baseUrl}/api/channels/${channelId}`, {
                method: 'DELETE',
                headers: authHeaders(aliceToken)
            })
            expect(delRes.status).toBe(200)
            expect((await delRes.json() as any).ok).toBe(true)

            // Verify gone
            const goneRes = await fetch(`${baseUrl}/api/channels/${channelId}`, {
                headers: authHeaders(aliceToken)
            })
            expect(goneRes.status).toBe(404)
        })
    })

    // ------------------------------------------------------------------
    // 3. Multi-user auth: cross-user visibility
    // ------------------------------------------------------------------
    describe('multi-user auth', () => {
        it('Alice and Bob see only their own channels; adding Bob gives access', async () => {
            // Alice creates a channel
            const createRes = await fetch(`${baseUrl}/api/channels`, {
                method: 'POST',
                headers: authHeaders(aliceToken),
                body: JSON.stringify({ name: 'alice-only' })
            })
            expect(createRes.status).toBe(201)
            const { channel } = await createRes.json() as any

            // Bob cannot see it
            const bobList = await fetch(`${baseUrl}/api/channels`, {
                headers: authHeaders(bobToken)
            })
            const { channels: bobChannels } = await bobList.json() as any
            expect(bobChannels).toHaveLength(0)

            // Bob gets 403 on direct access
            const bobGet = await fetch(`${baseUrl}/api/channels/${channel.id}`, {
                headers: authHeaders(bobToken)
            })
            expect(bobGet.status).toBe(403)

            // Alice adds Bob
            const addRes = await fetch(`${baseUrl}/api/channels/${channel.id}/members`, {
                method: 'POST',
                headers: authHeaders(aliceToken),
                body: JSON.stringify({ userId: '2', role: 'member' })
            })
            expect(addRes.status).toBe(200)

            // Bob can now see it
            const bobGetAfter = await fetch(`${baseUrl}/api/channels/${channel.id}`, {
                headers: authHeaders(bobToken)
            })
            expect(bobGetAfter.status).toBe(200)

            // Bob's channel list now has 1 entry
            const bobListAfter = await fetch(`${baseUrl}/api/channels`, {
                headers: authHeaders(bobToken)
            })
            const { channels: bobChannelsAfter } = await bobListAfter.json() as any
            expect(bobChannelsAfter).toHaveLength(1)
            expect(bobChannelsAfter[0].id).toBe(channel.id)

            // Cleanup
            await fetch(`${baseUrl}/api/channels/${channel.id}`, {
                method: 'DELETE',
                headers: authHeaders(aliceToken)
            })
        })
    })

    // ------------------------------------------------------------------
    // 4. Namespace isolation via JWT
    // ------------------------------------------------------------------
    describe('namespace isolation', () => {
        it('channel created in one namespace is invisible from another', async () => {
            const otherNsToken = await getToken(1, 'other-ns')

            // Create channel in test-ns
            const createRes = await fetch(`${baseUrl}/api/channels`, {
                method: 'POST',
                headers: authHeaders(aliceToken),
                body: JSON.stringify({ name: 'ns-scoped' })
            })
            const { channel } = await createRes.json() as any

            // Same user id but different namespace cannot see it
            const crossRes = await fetch(`${baseUrl}/api/channels/${channel.id}`, {
                headers: authHeaders(otherNsToken)
            })
            expect(crossRes.status).toBe(404)

            // Channel list in other namespace is empty
            const listRes = await fetch(`${baseUrl}/api/channels`, {
                headers: authHeaders(otherNsToken)
            })
            const { channels } = await listRes.json() as any
            expect(channels).toHaveLength(0)

            // Cleanup
            await fetch(`${baseUrl}/api/channels/${channel.id}`, {
                method: 'DELETE',
                headers: authHeaders(aliceToken)
            })
        })
    })

    // ------------------------------------------------------------------
    // 5. Workspace defaults through real HTTP
    // ------------------------------------------------------------------
    describe('workspace defaults', () => {
        it('ensure-defaults creates general and personal channels', async () => {
            const res = await fetch(`${baseUrl}/api/workspace/ensure-defaults`, {
                method: 'POST',
                headers: authHeaders(aliceToken),
                body: JSON.stringify({ displayName: 'Alice' })
            })
            expect(res.status).toBe(200)
            const data = await res.json() as any
            expect(data.generalChannel.name).toBe('general')
            expect(data.personalChannel.name).toBe("Alice's space")

            // Both visible in channel list
            const listRes = await fetch(`${baseUrl}/api/channels`, {
                headers: authHeaders(aliceToken)
            })
            const { channels } = await listRes.json() as any
            const names = channels.map((ch: any) => ch.name).sort()
            expect(names).toContain('general')
            expect(names).toContain("Alice's space")

            // Personal channel cannot be deleted
            const delRes = await fetch(`${baseUrl}/api/channels/${data.personalChannel.id}`, {
                method: 'DELETE',
                headers: authHeaders(aliceToken)
            })
            expect(delRes.status).toBe(403)
            expect((await delRes.json() as any).error).toBe('Cannot delete personal channel')
        })
    })
})
