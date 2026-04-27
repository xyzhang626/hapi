import type { Context } from 'hono'
import type { Machine, Session, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'

export function requireSyncEngine(
    c: Context<WebAppEnv>,
    getSyncEngine: () => SyncEngine | null
): SyncEngine | Response {
    const engine = getSyncEngine()
    if (!engine) {
        return c.json({ error: 'Not connected' }, 503)
    }
    return engine
}

export function requireSession(
    c: Context<WebAppEnv>,
    engine: SyncEngine,
    sessionId: string,
    options?: { requireActive?: boolean }
): { sessionId: string; session: Session } | Response {
    const namespace = c.get('namespace')
    const access = engine.resolveSessionAccess(sessionId, namespace)
    if (access.ok) {
        if (options?.requireActive && !access.session.active) {
            return c.json({ error: 'Session is inactive' }, 409)
        }
        return { sessionId: access.sessionId, session: access.session }
    }
    if (access.reason === 'access-denied') {
        // Stage 2: channel-bound sessions (bot session, threads) live in
        // channel.namespace. Channel members in *other* namespaces should
        // still see them — bot sessions are read-only across the whole
        // channel ("View only — interact in #channel"), and threads are
        // soft-private (any channel member can open, just visibility/UI
        // differs). Match by channel membership instead of namespace.
        const cross = engine.getSession(sessionId)
        if (cross && (cross.isChannelBot || (typeof cross.channelId === 'string' && cross.channelId.length > 0))) {
            const userId = String(c.get('userId') ?? '')
            if (userId && cross.channelId && engine.isChannelMember(cross.channelId, userId)) {
                if (options?.requireActive && !cross.active) {
                    return c.json({ error: 'Session is inactive' }, 409)
                }
                return { sessionId, session: cross }
            }
        }
    }
    const status = access.reason === 'access-denied' ? 403 : 404
    const error = access.reason === 'access-denied' ? 'Session access denied' : 'Session not found'
    return c.json({ error }, status)
}

export function requireSessionFromParam(
    c: Context<WebAppEnv>,
    engine: SyncEngine,
    options?: { paramName?: string; requireActive?: boolean }
): { sessionId: string; session: Session } | Response {
    const paramName = options?.paramName ?? 'id'
    const sessionId = c.req.param(paramName)
    const result = requireSession(c, engine, sessionId, { requireActive: options?.requireActive })
    if (result instanceof Response) {
        return result
    }
    return result
}

export function requireMachine(
    c: Context<WebAppEnv>,
    engine: SyncEngine,
    machineId: string
): Machine | Response {
    const namespace = c.get('namespace')
    const machine = engine.getMachine(machineId)
    if (!machine) {
        return c.json({ error: 'Machine not found' }, 404)
    }
    if (machine.namespace !== namespace) {
        return c.json({ error: 'Machine access denied' }, 403)
    }
    return machine
}
