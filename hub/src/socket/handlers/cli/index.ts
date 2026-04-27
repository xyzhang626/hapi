import type { CodexCollaborationMode, PermissionMode } from '@hapi/protocol/types'
import type { Store, StoredMachine, StoredSession } from '../../../store'
import type { RpcRegistry } from '../../rpcRegistry'
import type { SyncEngine, SyncEvent } from '../../../sync/syncEngine'
import type { TerminalRegistry } from '../../terminalRegistry'
import type { CliSocketWithData, SocketServer } from '../../socketTypes'
import type { AccessErrorReason, AccessResult } from './types'
import { registerChannelBotHandlers } from './channelBotHandlers'
import { registerMachineHandlers } from './machineHandlers'
import { registerRpcHandlers } from './rpcHandlers'
import { registerSessionHandlers } from './sessionHandlers'
import { cleanupTerminalHandlers, registerTerminalHandlers } from './terminalHandlers'

type SessionAlivePayload = {
    sid: string
    time: number
    thinking?: boolean
    mode?: 'local' | 'remote'
    permissionMode?: PermissionMode
    model?: string | null
    modelReasoningEffort?: string | null
    effort?: string | null
    collaborationMode?: CodexCollaborationMode
}

type SessionEndPayload = {
    sid: string
    time: number
}

type MachineAlivePayload = {
    machineId: string
    time: number
}

export type CliHandlersDeps = {
    io: SocketServer
    store: Store
    rpcRegistry: RpcRegistry
    terminalRegistry: TerminalRegistry
    onSessionAlive?: (payload: SessionAlivePayload) => void
    onSessionEnd?: (payload: SessionEndPayload) => void
    onMachineAlive?: (payload: MachineAlivePayload) => void
    onWebappEvent?: (event: SyncEvent) => void
    onBackgroundTaskDelta?: (sessionId: string, delta: { started: number; completed: number }) => void
    onSessionActivity?: (sessionId: string, updatedAt: number) => void
    getSyncEngine?: () => SyncEngine | null
}

export function registerCliHandlers(socket: CliSocketWithData, deps: CliHandlersDeps): void {
    const { io, store, rpcRegistry, terminalRegistry, onSessionAlive, onSessionEnd, onMachineAlive, onWebappEvent, onBackgroundTaskDelta, onSessionActivity, getSyncEngine } = deps
    const terminalNamespace = io.of('/terminal')
    const namespace = typeof socket.data.namespace === 'string' ? socket.data.namespace : null

    const resolveSessionAccess = (sessionId: string): AccessResult<StoredSession> => {
        if (!namespace) {
            return { ok: false, reason: 'namespace-missing' }
        }
        const session = store.sessions.getSessionByNamespace(sessionId, namespace)
        if (session) {
            return { ok: true, value: session }
        }
        // Stage 2: a channel-bound session (channel bot or thread) may have
        // been spawned by an embedded/shared runner whose CLI namespace differs
        // from the session's actual namespace (channel.namespace). Any
        // CLI-authenticated socket may operate on these sessions — the channel
        // is the access boundary, not the runner namespace. Without this,
        // the runner that spawned the bot can't subscribe to its own session.
        const crossNs = store.sessions.getSession(sessionId)
        if (crossNs && (crossNs.isChannelBot || (typeof crossNs.channelId === 'string' && crossNs.channelId.length > 0))) {
            return { ok: true, value: crossNs }
        }
        if (crossNs) {
            return { ok: false, reason: 'access-denied' }
        }
        return { ok: false, reason: 'not-found' }
    }

    const resolveMachineAccess = (machineId: string): AccessResult<StoredMachine> => {
        if (!namespace) {
            return { ok: false, reason: 'namespace-missing' }
        }
        const machine = store.machines.getMachineByNamespace(machineId, namespace)
        if (machine) {
            return { ok: true, value: machine }
        }
        if (store.machines.getMachine(machineId)) {
            return { ok: false, reason: 'access-denied' }
        }
        return { ok: false, reason: 'not-found' }
    }

    const auth = socket.handshake.auth as Record<string, unknown> | undefined
    const sessionId = typeof auth?.sessionId === 'string' ? auth.sessionId : null
    if (sessionId && resolveSessionAccess(sessionId).ok) {
        socket.join(`session:${sessionId}`)
    }

    const machineId = typeof auth?.machineId === 'string' ? auth.machineId : null
    if (machineId && resolveMachineAccess(machineId).ok) {
        socket.join(`machine:${machineId}`)
    }

    const emitAccessError = (scope: 'session' | 'machine', id: string, reason: AccessErrorReason) => {
        const message = reason === 'access-denied'
            ? `${scope} access denied`
            : reason === 'not-found'
                ? `${scope} not found`
                : 'Namespace missing'
        socket.emit('error', { message, code: reason, scope, id })
    }

    registerRpcHandlers(socket, rpcRegistry)
    registerSessionHandlers(socket, {
        store,
        resolveSessionAccess,
        emitAccessError,
        onSessionAlive,
        onSessionEnd,
        onWebappEvent,
        onBackgroundTaskDelta,
        onSessionActivity
    })
    registerMachineHandlers(socket, {
        store,
        resolveMachineAccess,
        emitAccessError,
        onMachineAlive,
        onWebappEvent
    })
    registerTerminalHandlers(socket, {
        terminalRegistry,
        terminalNamespace,
        resolveSessionAccess,
        emitAccessError
    })

    if (getSyncEngine) {
        registerChannelBotHandlers(socket, { store, getSyncEngine })
    }

    socket.on('ping', (callback: () => void) => {
        callback()
    })

    socket.on('disconnect', () => {
        rpcRegistry.unregisterAll(socket)
        cleanupTerminalHandlers(socket, { terminalRegistry, terminalNamespace })
        // Stage 2: synthesize session-end for any sessions this CLI socket
        // had reported as alive. Covers the bot-crash case where the CLI
        // subprocess is killed (SIGKILL / OOM) and never sends a graceful
        // session-end RPC. SIGTERM-shutdowns will already have fired
        // session-end and cleared the set, so this is the SIGKILL safety
        // net.
        const tracked = socket.data.trackedSessionIds
        if (tracked && tracked.size > 0 && onSessionEnd) {
            const now = Date.now()
            for (const sid of tracked) {
                onSessionEnd({ sid, time: now })
            }
            tracked.clear()
        }
    })
}
