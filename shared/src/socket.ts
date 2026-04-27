import { z } from 'zod'
import type { CodexCollaborationMode, PermissionMode } from './modes'

export type SocketErrorReason = 'namespace-missing' | 'access-denied' | 'not-found'

export const TerminalOpenPayloadSchema = z.object({
    sessionId: z.string().min(1),
    terminalId: z.string().min(1),
    cols: z.number().int().positive(),
    rows: z.number().int().positive()
})

export type TerminalOpenPayload = z.infer<typeof TerminalOpenPayloadSchema>

export const TerminalWritePayloadSchema = z.object({
    sessionId: z.string().min(1),
    terminalId: z.string().min(1),
    data: z.string()
})

export type TerminalWritePayload = z.infer<typeof TerminalWritePayloadSchema>

export const TerminalResizePayloadSchema = z.object({
    sessionId: z.string().min(1),
    terminalId: z.string().min(1),
    cols: z.number().int().positive(),
    rows: z.number().int().positive()
})

export type TerminalResizePayload = z.infer<typeof TerminalResizePayloadSchema>

export const TerminalClosePayloadSchema = z.object({
    sessionId: z.string().min(1),
    terminalId: z.string().min(1)
})

export type TerminalClosePayload = z.infer<typeof TerminalClosePayloadSchema>

export const TerminalReadyPayloadSchema = z.object({
    sessionId: z.string().min(1),
    terminalId: z.string().min(1)
})

export type TerminalReadyPayload = z.infer<typeof TerminalReadyPayloadSchema>

export const TerminalOutputPayloadSchema = z.object({
    sessionId: z.string().min(1),
    terminalId: z.string().min(1),
    data: z.string()
})

export type TerminalOutputPayload = z.infer<typeof TerminalOutputPayloadSchema>

export const TerminalExitPayloadSchema = z.object({
    sessionId: z.string().min(1),
    terminalId: z.string().min(1),
    code: z.number().int().nullable(),
    signal: z.string().nullable()
})

export type TerminalExitPayload = z.infer<typeof TerminalExitPayloadSchema>

export const TerminalErrorPayloadSchema = z.object({
    sessionId: z.string().min(1),
    terminalId: z.string().min(1),
    message: z.string()
})

export type TerminalErrorPayload = z.infer<typeof TerminalErrorPayloadSchema>

export const UpdateNewMessageBodySchema = z.object({
    t: z.literal('new-message'),
    sid: z.string(),
    message: z.object({
        id: z.string(),
        seq: z.number(),
        createdAt: z.number(),
        localId: z.string().nullable().optional(),
        content: z.unknown()
    })
})

export type UpdateNewMessageBody = z.infer<typeof UpdateNewMessageBodySchema>

export const UpdateSessionBodySchema = z.object({
    t: z.literal('update-session'),
    sid: z.string(),
    metadata: z.object({
        version: z.number(),
        value: z.unknown()
    }).nullable(),
    agentState: z.object({
        version: z.number(),
        value: z.unknown().nullable()
    }).nullable()
})

export type UpdateSessionBody = z.infer<typeof UpdateSessionBodySchema>

export const UpdateMachineBodySchema = z.object({
    t: z.literal('update-machine'),
    machineId: z.string(),
    metadata: z.object({
        version: z.number(),
        value: z.unknown()
    }).nullable(),
    runnerState: z.object({
        version: z.number(),
        value: z.unknown().nullable()
    }).nullable()
})

export type UpdateMachineBody = z.infer<typeof UpdateMachineBodySchema>

export const UpdateSchema = z.object({
    id: z.string(),
    seq: z.number(),
    body: z.union([UpdateNewMessageBodySchema, UpdateSessionBodySchema, UpdateMachineBodySchema]),
    createdAt: z.number()
})

export type Update = z.infer<typeof UpdateSchema>

export interface ServerToClientEvents {
    update: (data: Update) => void
    'rpc-request': (data: { method: string; params: string }, callback: (response: string) => void) => void
    'terminal:open': (data: TerminalOpenPayload) => void
    'terminal:write': (data: TerminalWritePayload) => void
    'terminal:resize': (data: TerminalResizePayload) => void
    'terminal:close': (data: TerminalClosePayload) => void
    error: (data: { message: string; code?: SocketErrorReason; scope?: 'session' | 'machine'; id?: string }) => void
}

export interface ClientToServerEvents {
    message: (data: { sid: string; message: unknown; localId?: string }) => void
    'session-alive': (data: {
        sid: string
        time: number
        thinking: boolean
        mode?: 'local' | 'remote'
        permissionMode?: PermissionMode
        model?: string | null
        modelReasoningEffort?: string | null
        effort?: string | null
        collaborationMode?: CodexCollaborationMode
    }) => void
    'session-end': (data: { sid: string; time: number }) => void
    'messages-consumed': (data: { sid: string; localIds: string[] }) => void
    'update-metadata': (data: { sid: string; expectedVersion: number; metadata: unknown }, cb: (answer: {
        result: 'error'
        reason?: SocketErrorReason
    } | {
        result: 'version-mismatch'
        version: number
        metadata: unknown | null
    } | {
        result: 'success'
        version: number
        metadata: unknown | null
    }) => void) => void
    'update-state': (data: { sid: string; expectedVersion: number; agentState: unknown | null }, cb: (answer: {
        result: 'error'
        reason?: SocketErrorReason
    } | {
        result: 'version-mismatch'
        version: number
        agentState: unknown | null
    } | {
        result: 'success'
        version: number
        agentState: unknown | null
    }) => void) => void
    'machine-alive': (data: { machineId: string; time: number }) => void
    'machine-update-metadata': (data: { machineId: string; expectedVersion: number; metadata: unknown }, cb: (answer: {
        result: 'error'
        reason?: SocketErrorReason
    } | {
        result: 'version-mismatch'
        version: number
        metadata: unknown | null
    } | {
        result: 'success'
        version: number
        metadata: unknown | null
    }) => void) => void
    'machine-update-state': (data: { machineId: string; expectedVersion: number; runnerState: unknown | null }, cb: (answer: {
        result: 'error'
        reason?: SocketErrorReason
    } | {
        result: 'version-mismatch'
        version: number
        runnerState: unknown | null
    } | {
        result: 'success'
        version: number
        runnerState: unknown | null
    }) => void) => void
    'rpc-register': (data: { method: string }) => void
    'rpc-unregister': (data: { method: string }) => void
    'terminal:ready': (data: TerminalReadyPayload) => void
    'terminal:output': (data: TerminalOutputPayload) => void
    'terminal:exit': (data: TerminalExitPayload) => void
    'terminal:error': (data: TerminalErrorPayload) => void
    ping: (callback: () => void) => void
    'usage-report': (data: unknown) => void
    // ─── Stage 2: channel-bot RPC events ─────────────────────────────
    'channel-bot:send-message': (data: { sid: string; text: string }, cb: ChannelBotAck<{ messageId: string; seq: number }>) => void
    'channel-bot:react-to-message': (data: { sid: string; messageId: string; emoji: string }, cb: ChannelBotAck<{ result: 'added' | 'removed' }>) => void
    'channel-bot:spawn-thread': (data: { sid: string; title: string; prompt: string; flavor?: string; model?: string }, cb: ChannelBotAck<{ threadSessionId: string }>) => void
    'channel-bot:spawn-scheduled-thread': (data: { sid: string; title: string; prompt: string; schedule: string; flavor?: string; model?: string }, cb: ChannelBotAck<{ threadSessionId: string }>) => void
    'channel-bot:cancel-thread': (data: { sid: string; threadId: string; reason?: string }, cb: ChannelBotAck<{ ok: true }>) => void
    'channel-bot:send-to-thread': (data: { sid: string; threadId: string; text: string }, cb: ChannelBotAck<{ messageId: string }>) => void
    'channel-bot:pin-thread': (data: { sid: string; threadId: string }, cb: ChannelBotAck<{ ok: true }>) => void
    'channel-bot:unpin-thread': (data: { sid: string; threadId: string }, cb: ChannelBotAck<{ ok: true }>) => void
    'channel-bot:list-threads': (data: { sid: string }, cb: ChannelBotAck<{ threads: ChannelBotThread[] }>) => void
    'channel-bot:get-thread': (data: { sid: string; threadId: string }, cb: ChannelBotAck<{ thread: ChannelBotThread & { todos: unknown } }>) => void
    'channel-bot:get-channel-history': (data: { sid: string; beforeSeq?: number; limit?: number }, cb: ChannelBotAck<{ messages: ChannelBotHistoryMessage[] }>) => void
    'channel-bot:list-channel-members': (data: { sid: string }, cb: ChannelBotAck<{ members: ChannelBotMember[] }>) => void
}

export type ChannelBotAck<T> = (response: { ok: true; data: T } | { ok: false; error: string }) => void

export interface ChannelBotThread {
    id: string
    title: string | null
    status: string | null
    visibility: string
    scheduled: boolean
    schedule: string | null
    pinned: boolean
    active: boolean
    createdAt: number
    updatedAt: number
}

export interface ChannelBotHistoryMessage {
    id: string
    kind: string
    authorUserId: string | null
    body: unknown
    seq: number
    createdAt: number
}

export interface ChannelBotMember {
    userId: string
    displayName: string
    role: string
}
