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
            store.channelMessageReactions.remove(messageId, reactorRef, emoji)
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
            return await next()
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

        it('only the channel owner can edit agentConfig', async () => {
            // Alice creates a channel with an initial agentConfig
            const createRes = await fetch(`${baseUrl}/api/channels`, {
                method: 'POST',
                headers: authHeaders(aliceToken),
                body: JSON.stringify({ name: 'agentcfg-owner', agentConfig: { botName: 'Sherlock' } })
            })
            expect(createRes.status).toBe(201)
            const { channel } = await createRes.json() as any

            // Alice adds Bob as member
            await fetch(`${baseUrl}/api/channels/${channel.id}/members`, {
                method: 'POST',
                headers: authHeaders(aliceToken),
                body: JSON.stringify({ userId: '2', role: 'member' })
            })

            // Bob (member, non-owner) tries to edit agentConfig — must 403
            const bobUpdate = await fetch(`${baseUrl}/api/channels/${channel.id}`, {
                method: 'PUT',
                headers: authHeaders(bobToken),
                body: JSON.stringify({ agentConfig: { botName: 'Hacker' } })
            })
            expect(bobUpdate.status).toBe(403)
            const bobErr = await bobUpdate.json() as any
            expect(bobErr.error).toContain('owner')

            // Bob can still edit non-agentConfig fields (description)
            const bobDescUpdate = await fetch(`${baseUrl}/api/channels/${channel.id}`, {
                method: 'PUT',
                headers: authHeaders(bobToken),
                body: JSON.stringify({ description: 'updated by member' })
            })
            expect(bobDescUpdate.status).toBe(200)

            // Alice (owner) can edit agentConfig
            const aliceUpdate = await fetch(`${baseUrl}/api/channels/${channel.id}`, {
                method: 'PUT',
                headers: authHeaders(aliceToken),
                body: JSON.stringify({ agentConfig: { botName: 'Watson' } })
            })
            expect(aliceUpdate.status).toBe(200)
            const updated = await aliceUpdate.json() as any
            expect(updated.channel.agentConfig.botName).toBe('Watson')

            // Cleanup
            await fetch(`${baseUrl}/api/channels/${channel.id}`, {
                method: 'DELETE',
                headers: authHeaders(aliceToken)
            })
        })
    })

    // ------------------------------------------------------------------
    // 4. Membership-based isolation (Stage 2: cross-namespace by membership)
    // ------------------------------------------------------------------
    describe('membership isolation', () => {
        it('channel is invisible to a different user who has not joined', async () => {
            // Stage 2 changed the access model from "namespace match" to
            // "channel-membership match". A different user (different uid)
            // who has not been invited cannot see the channel — even if
            // they share a namespace, even more so when they don't.
            const strangerToken = await getToken(99, 'other-ns')

            const createRes = await fetch(`${baseUrl}/api/channels`, {
                method: 'POST',
                headers: authHeaders(aliceToken),
                body: JSON.stringify({ name: 'ns-scoped' })
            })
            const { channel } = await createRes.json() as any

            // Stranger gets 403 (channel exists, not a member) on direct fetch
            const crossRes = await fetch(`${baseUrl}/api/channels/${channel.id}`, {
                headers: authHeaders(strangerToken)
            })
            expect(crossRes.status).toBe(403)

            // Channel list for the stranger does not include this channel
            const listRes = await fetch(`${baseUrl}/api/channels`, {
                headers: authHeaders(strangerToken)
            })
            const { channels } = await listRes.json() as any
            expect(channels.find((ch: any) => ch.id === channel.id)).toBeUndefined()

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

    // ------------------------------------------------------------------
    // 6. Reactions (Stage 2)
    // ------------------------------------------------------------------
    describe('message reactions', () => {
        it('toggle adds and removes a reaction; GET messages includes reactions[]', async () => {
            // Alice creates a channel + sends a message
            const createRes = await fetch(`${baseUrl}/api/channels`, {
                method: 'POST', headers: authHeaders(aliceToken),
                body: JSON.stringify({ name: 'reactions-test' })
            })
            const { channel } = await createRes.json() as any

            const sendRes = await fetch(`${baseUrl}/api/channels/${channel.id}/messages`, {
                method: 'POST', headers: authHeaders(aliceToken),
                body: JSON.stringify({ body: { text: 'react to me' } })
            })
            const { message } = await sendRes.json() as any

            // Alice toggles 👀 → added
            const r1 = await fetch(`${baseUrl}/api/channels/${channel.id}/messages/${message.id}/reactions`, {
                method: 'POST', headers: authHeaders(aliceToken),
                body: JSON.stringify({ emoji: '👀' })
            })
            expect(r1.status).toBe(200)
            expect((await r1.json() as any).result).toBe('added')

            // GET messages includes reactions
            const msgsRes = await fetch(`${baseUrl}/api/channels/${channel.id}/messages`, {
                headers: authHeaders(aliceToken)
            })
            const { messages } = await msgsRes.json() as any
            expect(messages[0].reactions).toHaveLength(1)
            expect(messages[0].reactions[0].emoji).toBe('👀')
            expect(messages[0].reactions[0].reactorRef).toBe('user:1')

            // Alice toggles 👀 again → removed
            const r2 = await fetch(`${baseUrl}/api/channels/${channel.id}/messages/${message.id}/reactions`, {
                method: 'POST', headers: authHeaders(aliceToken),
                body: JSON.stringify({ emoji: '👀' })
            })
            expect((await r2.json() as any).result).toBe('removed')

            // Cleanup
            await fetch(`${baseUrl}/api/channels/${channel.id}`, { method: 'DELETE', headers: authHeaders(aliceToken) })
        })

        it('non-member cannot react', async () => {
            const createRes = await fetch(`${baseUrl}/api/channels`, {
                method: 'POST', headers: authHeaders(aliceToken),
                body: JSON.stringify({ name: 'private-react' })
            })
            const { channel } = await createRes.json() as any
            const sendRes = await fetch(`${baseUrl}/api/channels/${channel.id}/messages`, {
                method: 'POST', headers: authHeaders(aliceToken),
                body: JSON.stringify({ body: { text: 'private msg' } })
            })
            const { message } = await sendRes.json() as any
            const bobReact = await fetch(`${baseUrl}/api/channels/${channel.id}/messages/${message.id}/reactions`, {
                method: 'POST', headers: authHeaders(bobToken),
                body: JSON.stringify({ emoji: '👀' })
            })
            expect(bobReact.status).toBe(403)
            await fetch(`${baseUrl}/api/channels/${channel.id}`, { method: 'DELETE', headers: authHeaders(aliceToken) })
        })
    })
})
