import { Hono } from 'hono'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { PROTOCOL_VERSION } from '@hapi/protocol'
import { configuration } from '../../configuration'
import { constantTimeEquals } from '../../utils/crypto'
import { parseAccessToken } from '../../utils/accessToken'
import type { Machine, Session, SyncEngine } from '../../sync/syncEngine'

const bearerSchema = z.string().regex(/^Bearer\s+(.+)$/i)

const createOrLoadSessionSchema = z.object({
    tag: z.string().min(1),
    metadata: z.unknown(),
    agentState: z.unknown().nullable().optional(),
    model: z.string().optional(),
    modelReasoningEffort: z.string().optional(),
    effort: z.string().optional()
})

const createOrLoadMachineSchema = z.object({
    id: z.string().min(1),
    metadata: z.unknown(),
    runnerState: z.unknown().nullable().optional()
})

const getMessagesQuerySchema = z.object({
    afterSeq: z.coerce.number().int().min(0),
    limit: z.coerce.number().int().min(1).max(200).optional()
})

type CliEnv = {
    Variables: {
        namespace: string
        /** Derived from sha256(namespace:displayName) when the access
         *  token includes a displayName segment. Used to auto-attach
         *  vanilla CLI sessions to the user's personal channel. */
        cliUserId: string | null
    }
}

function resolveSessionForNamespace(
    engine: SyncEngine,
    sessionId: string,
    namespace: string
): { ok: true; session: Session; sessionId: string } | { ok: false; status: 403 | 404; error: string } {
    const access = engine.resolveSessionAccess(sessionId, namespace)
    if (access.ok) {
        return { ok: true, session: access.session, sessionId: access.sessionId }
    }
    // Stage 2: channel-bound sessions (bot or thread) live in the channel's
    // namespace. The runner CLI may auth in a different namespace (typically
    // 'default' for the embedded runner) yet still need to read/write its
    // own spawned session — same justification as the socket-side widening
    // in hub/src/socket/handlers/cli/index.ts. Treat any /cli auth as
    // sufficient when the session is channel-bound.
    if (access.reason === 'access-denied') {
        const cross = engine.getSession(sessionId)
        if (cross && (cross.isChannelBot || (typeof cross.channelId === 'string' && cross.channelId.length > 0))) {
            return { ok: true, session: cross, sessionId }
        }
    }
    return {
        ok: false,
        status: access.reason === 'access-denied' ? 403 : 404,
        error: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found'
    }
}

function resolveMachineForNamespace(
    engine: SyncEngine,
    machineId: string,
    namespace: string
): { ok: true; machine: Machine } | { ok: false; status: 403 | 404; error: string } {
    const machine = engine.getMachineByNamespace(machineId, namespace)
    if (machine) {
        return { ok: true, machine }
    }
    if (engine.getMachine(machineId)) {
        return { ok: false, status: 403, error: 'Machine access denied' }
    }
    return { ok: false, status: 404, error: 'Machine not found' }
}

export function createCliRoutes(getSyncEngine: () => SyncEngine | null): Hono<CliEnv> {
    const app = new Hono<CliEnv>()

    app.use('*', async (c, next) => {
        c.header('X-Hapi-Protocol-Version', String(PROTOCOL_VERSION))

        const raw = c.req.header('authorization')
        if (!raw) {
            return c.json({ error: 'Missing Authorization header' }, 401)
        }

        const parsed = bearerSchema.safeParse(raw)
        if (!parsed.success) {
            return c.json({ error: 'Invalid Authorization header' }, 401)
        }

        const token = parsed.data.replace(/^Bearer\s+/i, '')
        const parsedToken = parseAccessToken(token)
        if (!parsedToken || !constantTimeEquals(parsedToken.baseToken, configuration.cliApiToken)) {
            return c.json({ error: 'Invalid token' }, 401)
        }

        c.set('namespace', parsedToken.namespace)
        // Derive a stable per-user id when the token includes a displayName
        // (token format: <token>:<namespace>:<displayName>). Mirrors the
        // derivation in hub/src/web/routes/auth.ts so the CLI userId matches
        // the web userId for the same human, allowing channel attribution
        // and personal-channel auto-attach to work.
        if (parsedToken.displayName) {
            const uid = createHash('sha256')
                .update(`${parsedToken.namespace}:${parsedToken.displayName}`)
                .digest()
                .readUInt32BE(0)
            c.set('cliUserId', String(uid))
        } else {
            c.set('cliUserId', null)
        }
        return await next()
    })

    app.post('/sessions', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = createOrLoadSessionSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        // Stage 2: promote channel-bot fields from metadata to top-level columns
        // so the SSE channel-bot-typing emitter (and other gates that read
        // session.isChannelBot directly) actually fire. Without this, the CLI
        // would write isChannelBot only into the metadata blob and the column
        // stays at 0.
        const meta = parsed.data.metadata as
            | {
                isChannelBot?: boolean
                channelId?: string
                threadTitle?: string
                createdByUserId?: string
                scheduledThread?: boolean
                threadSchedule?: string
            }
            | null
            | undefined
        type ChannelOpts = {
            channelId?: string
            threadTitle?: string
            createdByUserId?: string
            isChannelBot?: boolean
            scheduled?: boolean
            schedule?: string
        }
        let channelOpts: ChannelOpts | undefined = meta && typeof meta === 'object' ? {
            channelId: typeof meta.channelId === 'string' ? meta.channelId : undefined,
            threadTitle: typeof meta.threadTitle === 'string' ? meta.threadTitle : undefined,
            createdByUserId: typeof meta.createdByUserId === 'string' ? meta.createdByUserId : undefined,
            isChannelBot: meta.isChannelBot === true ? true : undefined,
            scheduled: meta.scheduledThread === true ? true : undefined,
            schedule: typeof meta.threadSchedule === 'string' ? meta.threadSchedule : undefined
        } : undefined

        const callerNamespace = c.get('namespace')
        const cliUserId = c.get('cliUserId')

        // Spec mvp-user-experience.md: vanilla CLI sessions auto-land in the
        // owner's #private channel as thread cards. Without this, `hapi run`
        // produces sessions with channel_id=NULL that are invisible from the
        // /channels view. Skip when channelId is already set (the embedded
        // runner spawning channel bots/threads passes its own) or when this
        // is a channel-bot session (those live attached but never on behalf
        // of a real user).
        let autoAttachedToPersonal = false
        if (
            !channelOpts?.channelId
            && !channelOpts?.isChannelBot
            && cliUserId
        ) {
            const personalId = engine.getPersonalChannelId(callerNamespace, cliUserId)
            if (personalId) {
                const tag = parsed.data.tag
                channelOpts = {
                    ...(channelOpts ?? {}),
                    channelId: personalId,
                    threadTitle: channelOpts?.threadTitle ?? tag,
                    createdByUserId: channelOpts?.createdByUserId ?? cliUserId
                }
                autoAttachedToPersonal = true
            }
        }

        // Stage 2: when this session is bound to a channel (bot or thread),
        // it must live in the channel's namespace — not the runner's. The
        // embedded runner authenticates as 'default'; without this remap a
        // bot spawned for a channel in 'alice' would land in 'default' and
        // become unreachable to its owner (Alice can't view it, MCP tools
        // can't find the channel, watchdog respawns into the wrong ns).
        let namespace = callerNamespace
        if (channelOpts?.channelId) {
            const channel = engine.getChannelById(channelOpts.channelId)
            if (channel) {
                namespace = channel.namespace
            }
        }
        const session = engine.getOrCreateSession(
            parsed.data.tag,
            parsed.data.metadata,
            parsed.data.agentState ?? null,
            namespace,
            parsed.data.model,
            parsed.data.effort,
            parsed.data.modelReasoningEffort,
            channelOpts
        )

        // Auto-emit the thread_card on FIRST attach to the personal channel
        // (subsequent POSTs with the same tag are idempotent loads — no
        // duplicate card). Detect first attach by checking if the session's
        // current channelId was newly set this call.
        if (autoAttachedToPersonal && channelOpts?.channelId) {
            const existingCards = engine.getChannelMessages(channelOpts.channelId, { limit: 200 })
            const alreadyEmitted = existingCards.some((m) => {
                if (m.kind !== 'thread_card') return false
                const body = m.body as { threadId?: string } | null
                return body?.threadId === session.id
            })
            if (!alreadyEmitted) {
                engine.sendChannelMessage(
                    channelOpts.channelId,
                    namespace,
                    null,
                    'thread_card',
                    {
                        status: 'active',
                        taskTitle: channelOpts.threadTitle,
                        threadId: session.id,
                        startedAt: Date.now(),
                        startedBy: cliUserId,
                        scheduled: false,
                        schedule: null,
                        visibility: 'private'
                    },
                    session.id
                )
            }
        }

        return c.json({ session })
    })

    app.get('/sessions/:id', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const sessionId = c.req.param('id')
        const namespace = c.get('namespace')
        const resolved = resolveSessionForNamespace(engine, sessionId, namespace)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }
        return c.json({ session: resolved.session })
    })

    app.get('/sessions/:id/messages', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const sessionId = c.req.param('id')
        const namespace = c.get('namespace')
        const resolved = resolveSessionForNamespace(engine, sessionId, namespace)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }

        const parsed = getMessagesQuerySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query' }, 400)
        }

        const limit = parsed.data.limit ?? 200
        const messages = engine.getMessagesAfter(resolved.sessionId, { afterSeq: parsed.data.afterSeq, limit })
        return c.json({ messages })
    })

    app.post('/machines', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = createOrLoadMachineSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const namespace = c.get('namespace')
        const existing = engine.getMachine(parsed.data.id)
        if (existing && existing.namespace !== namespace) {
            return c.json({ error: 'Machine access denied' }, 403)
        }
        const machine = engine.getOrCreateMachine(parsed.data.id, parsed.data.metadata, parsed.data.runnerState ?? null, namespace)
        return c.json({ machine })
    })

    app.get('/machines/:id', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const machineId = c.req.param('id')
        const namespace = c.get('namespace')
        const resolved = resolveMachineForNamespace(engine, machineId, namespace)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }
        return c.json({ machine: resolved.machine })
    })

    return app
}
