/**
 * Sync Engine for HAPI Telegram Bot (Direct Connect)
 *
 * In the direct-connect architecture:
 * - hapi-hub is the hub (Socket.IO + REST)
 * - hapi CLI connects directly to the hub (no relay)
 * - No E2E encryption; data is stored as JSON in SQLite
 */

import type { CodexCollaborationMode, DecryptedMessage, PermissionMode, Session, SyncEvent } from '@hapi/protocol/types'
import type { Server } from 'socket.io'
import type { Store } from '../store'
import type { StoredChannel, StoredChannelMember, StoredChannelMessage } from '../store/types'
import type { RpcRegistry } from '../socket/rpcRegistry'
import type { SSEManager } from '../sse/sseManager'
import { ChannelCache } from './channelCache'
import { EventPublisher, type SyncEventListener } from './eventPublisher'
import { MachineCache, type Machine } from './machineCache'
import { MessageService } from './messageService'
import {
    RpcGateway,
    type RpcCodexModel,
    type RpcCommandResponse,
    type RpcDeleteUploadResponse,
    type RpcListDirectoryResponse,
    type RpcListCodexModelsResponse,
    type RpcPathExistsResponse,
    type RpcReadFileResponse,
    type RpcUploadFileResponse
} from './rpcGateway'
import { SessionCache } from './sessionCache'

export type { Session, SyncEvent } from '@hapi/protocol/types'
export type { Machine } from './machineCache'
export type { SyncEventListener } from './eventPublisher'
export type {
    RpcCodexModel,
    RpcCommandResponse,
    RpcDeleteUploadResponse,
    RpcListDirectoryResponse,
    RpcListCodexModelsResponse,
    RpcPathExistsResponse,
    RpcReadFileResponse,
    RpcUploadFileResponse
} from './rpcGateway'

export type ResumeSessionResult =
    | { type: 'success'; sessionId: string }
    | { type: 'error'; message: string; code: 'session_not_found' | 'access_denied' | 'no_machine_online' | 'resume_unavailable' | 'resume_failed' }

export class SyncEngine {
    private readonly store: Store
    private readonly sseManager: SSEManager
    private readonly eventPublisher: EventPublisher
    private readonly sessionCache: SessionCache
    private readonly machineCache: MachineCache
    private readonly channelCache: ChannelCache
    private readonly messageService: MessageService
    private readonly rpcGateway: RpcGateway
    private agentConfigStore: import('../agentConfig/agentConfigStore').AgentConfigStore | null = null
    private agentConfigUnsub: (() => void) | null = null
    private inactivityTimer: NodeJS.Timeout | null = null

    constructor(
        store: Store,
        io: Server,
        rpcRegistry: RpcRegistry,
        sseManager: SSEManager
    ) {
        this.store = store
        this.sseManager = sseManager
        this.eventPublisher = new EventPublisher(sseManager, (event) => this.resolveNamespace(event))
        this.sessionCache = new SessionCache(store, this.eventPublisher)
        this.machineCache = new MachineCache(store, this.eventPublisher)
        this.channelCache = new ChannelCache(store, this.eventPublisher)
        this.messageService = new MessageService(
            store,
            io,
            this.eventPublisher,
            (sessionId, updatedAt) => this.recordSessionActivity(sessionId, updatedAt)
        )
        this.rpcGateway = new RpcGateway(io, rpcRegistry)
        this.reloadAll()
        this.inactivityTimer = setInterval(() => this.expireInactive(), 5_000)
    }

    /**
     * Stage 2: attach an AgentConfigStore. When file changes are detected,
     * the cached DB record is updated and a `__config_updated` system message
     * is injected into the channel's bot session.
     */
    attachAgentConfigStore(store: import('../agentConfig/agentConfigStore').AgentConfigStore): void {
        this.agentConfigStore = store
        this.agentConfigUnsub?.()
        this.agentConfigUnsub = store.subscribe((change) => {
            // Find which namespace this channel belongs to and update its DB record.
            const namespace = this.channelCache.getChannelNamespace(change.channelId)
            if (!namespace) return
            this.store.channels.updateChannel(change.channelId, namespace, { agentConfig: change.config })
            this.channelCache.updateChannel(change.channelId, namespace)
            // Inject __config_updated into the bot session if any
            const refreshed = this.store.channels.getChannel(change.channelId, namespace)
            const botSessionId = refreshed?.botSessionId
            if (botSessionId) {
                const text = `<system>__config_updated</system>\n${change.rawText}`
                void this.sendMessage(botSessionId, { text, sentFrom: 'webapp' }).catch((err) => {
                    console.error('[SyncEngine] inject __config_updated failed:', err)
                })
            }
        })
    }

    stop(): void {
        if (this.inactivityTimer) {
            clearInterval(this.inactivityTimer)
            this.inactivityTimer = null
        }
    }

    subscribe(listener: SyncEventListener): () => void {
        return this.eventPublisher.subscribe(listener)
    }

    private resolveNamespace(event: SyncEvent): string | undefined {
        if (event.namespace) {
            return event.namespace
        }
        if ('sessionId' in event) {
            return this.getSession(event.sessionId)?.namespace
        }
        if ('machineId' in event) {
            return this.machineCache.getMachine(event.machineId)?.namespace
        }
        if ('channelId' in event) {
            return this.channelCache.getChannelNamespace(event.channelId)
        }
        return undefined
    }

    getSessions(): Session[] {
        return this.sessionCache.getSessions()
    }

    getSessionsByNamespace(namespace: string, opts?: { channelId?: string }): Session[] {
        return this.sessionCache.getSessionsByNamespace(namespace, opts)
    }

    getSession(sessionId: string): Session | undefined {
        return this.sessionCache.getSession(sessionId) ?? this.sessionCache.refreshSession(sessionId) ?? undefined
    }

    getSessionByNamespace(sessionId: string, namespace: string): Session | undefined {
        const session = this.sessionCache.getSessionByNamespace(sessionId, namespace)
            ?? this.sessionCache.refreshSession(sessionId)
        if (!session || session.namespace !== namespace) {
            return undefined
        }
        return session
    }

    resolveSessionAccess(
        sessionId: string,
        namespace: string
    ): { ok: true; sessionId: string; session: Session } | { ok: false; reason: 'not-found' | 'access-denied' } {
        return this.sessionCache.resolveSessionAccess(sessionId, namespace)
    }

    getActiveSessions(): Session[] {
        return this.sessionCache.getActiveSessions()
    }

    getMachines(): Machine[] {
        return this.machineCache.getMachines()
    }

    getMachinesByNamespace(namespace: string): Machine[] {
        return this.machineCache.getMachinesByNamespace(namespace)
    }

    getMachine(machineId: string): Machine | undefined {
        return this.machineCache.getMachine(machineId)
    }

    getMachineByNamespace(machineId: string, namespace: string): Machine | undefined {
        return this.machineCache.getMachineByNamespace(machineId, namespace)
    }

    getOnlineMachines(): Machine[] {
        return this.machineCache.getOnlineMachines()
    }

    getOnlineMachinesByNamespace(namespace: string): Machine[] {
        return this.machineCache.getOnlineMachinesByNamespace(namespace)
    }

    getMessagesPage(sessionId: string, options: { limit: number; beforeSeq: number | null }): {
        messages: DecryptedMessage[]
        page: {
            limit: number
            beforeSeq: number | null
            nextBeforeSeq: number | null
            hasMore: boolean
        }
    } {
        return this.messageService.getMessagesPage(sessionId, options)
    }

    getMessagesAfter(sessionId: string, options: { afterSeq: number; limit: number }): DecryptedMessage[] {
        return this.messageService.getMessagesAfter(sessionId, options)
    }

    handleRealtimeEvent(event: SyncEvent): void {
        if (event.type === 'session-updated' && event.sessionId) {
            // Snapshot agent session IDs before refresh — safe because JS is single-threaded
            // and refreshSession replaces the Map entry with a new object.
            const before = this.sessionCache.getSession(event.sessionId)
            this.sessionCache.refreshSession(event.sessionId)
            const after = this.sessionCache.getSession(event.sessionId)
            if (after?.metadata && !this.hasSameAgentSessionIds(before?.metadata ?? null, after.metadata)) {
                void this.sessionCache.deduplicateByAgentSessionId(event.sessionId).catch(() => {
                    // best-effort: dedup failure is harmless, web-side safety net hides remaining duplicates
                })
            }
            return
        }

        if (event.type === 'machine-updated' && event.machineId) {
            this.machineCache.refreshMachine(event.machineId)
            return
        }

        if (event.type === 'message-received' && event.sessionId) {
            if (!this.getSession(event.sessionId)) {
                this.sessionCache.refreshSession(event.sessionId)
            }
        }

        this.eventPublisher.emit(event)
    }

    handleSessionAlive(payload: {
        sid: string
        time: number
        thinking?: boolean
        mode?: 'local' | 'remote'
        permissionMode?: PermissionMode
        model?: string | null
        modelReasoningEffort?: string | null
        effort?: string | null
        collaborationMode?: CodexCollaborationMode
    }): void {
        this.sessionCache.handleSessionAlive(payload)
        this.triggerDedupIfNeeded(payload.sid)
    }

    handleSessionEnd(payload: { sid: string; time: number }): void {
        this.sessionCache.handleSessionEnd(payload)
        // Retry dedup now that this session is inactive — a prior dedup may have
        // skipped it because it was still active at the time.
        this.triggerDedupIfNeeded(payload.sid)
        // Channel-bot watchdog: if this session is a channel bot, schedule a restart
        // with the previous sessionId so context is preserved.
        const session = this.store.sessions.getSession(payload.sid)
        if (session?.isChannelBot && session.channelId) {
            const channelId = session.channelId
            const namespace = session.namespace
            const oldSessionId = payload.sid
            console.log(`[SyncEngine] Channel bot ${oldSessionId} ended — scheduling restart for channel ${channelId}`)
            setTimeout(() => {
                this.spawnChannelBot(channelId, namespace, { resumeSessionId: oldSessionId }).catch((err) => {
                    console.error('[SyncEngine] Channel bot restart failed:', err)
                })
            }, 5000)
        }
    }

    handleBackgroundTaskDelta(sessionId: string, delta: { started: number; completed: number }): void {
        this.sessionCache.applyBackgroundTaskDelta(sessionId, delta)
    }

    recordSessionActivity(sessionId: string, updatedAt: number): void {
        this.sessionCache.recordSessionActivity(sessionId, updatedAt)
    }

    handleMachineAlive(payload: { machineId: string; time: number }): void {
        this.machineCache.handleMachineAlive(payload)
    }

    private expireInactive(): void {
        const expired = this.sessionCache.expireInactive()
        // Sort by most recent first so dedup keeps the newest session when multiple
        // duplicates for the same agent thread expire in the same sweep.
        const sorted = expired
            .map((id) => this.sessionCache.getSession(id))
            .filter((s): s is NonNullable<typeof s> => s != null)
            .sort((a, b) => (b.activeAt - a.activeAt) || (b.updatedAt - a.updatedAt))
        for (const session of sorted) {
            this.triggerDedupIfNeeded(session.id)
        }
        this.machineCache.expireInactive()
    }

    private reloadAll(): void {
        this.sessionCache.reloadAll()
        this.machineCache.reloadAll()
        this.channelCache.reloadAll()
    }

    getOrCreateSession(
        tag: string,
        metadata: unknown,
        agentState: unknown,
        namespace: string,
        model?: string,
        effort?: string,
        modelReasoningEffort?: string,
        channelOpts?: { channelId?: string; threadTitle?: string; createdByUserId?: string }
    ): Session {
        return this.sessionCache.getOrCreateSession(tag, metadata, agentState, namespace, model, effort, modelReasoningEffort, channelOpts)
    }

    getOrCreateMachine(id: string, metadata: unknown, runnerState: unknown, namespace: string): Machine {
        return this.machineCache.getOrCreateMachine(id, metadata, runnerState, namespace)
    }

    async sendMessage(
        sessionId: string,
        payload: {
            text: string
            localId?: string | null
            attachments?: Array<{
                id: string
                filename: string
                mimeType: string
                size: number
                path: string
                previewUrl?: string
            }>
            sentFrom?: 'telegram-bot' | 'webapp'
        }
    ): Promise<void> {
        await this.messageService.sendMessage(sessionId, payload)
    }

    async approvePermission(
        sessionId: string,
        requestId: string,
        mode?: PermissionMode,
        allowTools?: string[],
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort',
        answers?: Record<string, string[]> | Record<string, { answers: string[] }>
    ): Promise<void> {
        await this.rpcGateway.approvePermission(sessionId, requestId, mode, allowTools, decision, answers)
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
    ): Promise<void> {
        await this.rpcGateway.denyPermission(sessionId, requestId, decision)
    }

    async abortSession(sessionId: string): Promise<void> {
        await this.rpcGateway.abortSession(sessionId)
    }

    async archiveSession(sessionId: string): Promise<void> {
        await this.rpcGateway.killSession(sessionId)
        this.handleSessionEnd({ sid: sessionId, time: Date.now() })
    }

    async switchSession(sessionId: string, to: 'remote' | 'local'): Promise<void> {
        await this.rpcGateway.switchSession(sessionId, to)
    }

    async renameSession(sessionId: string, name: string): Promise<void> {
        await this.sessionCache.renameSession(sessionId, name)
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.sessionCache.deleteSession(sessionId)
    }

    async applySessionConfig(
        sessionId: string,
        config: {
            permissionMode?: PermissionMode
            model?: string | null
            modelReasoningEffort?: string | null
            effort?: string | null
            collaborationMode?: CodexCollaborationMode
        }
    ): Promise<void> {
        const result = await this.rpcGateway.requestSessionConfig(sessionId, config)
        if (!result || typeof result !== 'object') {
            throw new Error('Invalid response from session config RPC')
        }
        const obj = result as {
            applied?: {
                permissionMode?: Session['permissionMode']
                model?: Session['model']
                modelReasoningEffort?: Session['modelReasoningEffort']
                effort?: Session['effort']
                collaborationMode?: Session['collaborationMode']
            }
        }
        const applied = obj.applied
        if (!applied || typeof applied !== 'object') {
            throw new Error('Missing applied session config')
        }

        this.sessionCache.applySessionConfig(sessionId, applied)
    }

    async spawnSession(
        machineId: string,
        directory: string,
        agent: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode' = 'claude',
        model?: string,
        modelReasoningEffort?: string,
        yolo?: boolean,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string,
        resumeSessionId?: string,
        effort?: string,
        permissionMode?: PermissionMode,
        extras?: {
            isChannelBot?: boolean
            channelId?: string
            botName?: string
            agentConfigJson?: string
            scheduled?: boolean
            schedule?: string
            customSystemPrompt?: string
        }
    ): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }> {
        return await this.rpcGateway.spawnSession(
            machineId,
            directory,
            agent,
            model,
            modelReasoningEffort,
            yolo,
            sessionType,
            worktreeName,
            resumeSessionId,
            effort,
            permissionMode,
            extras
        )
    }

    async resumeSession(sessionId: string, namespace: string): Promise<ResumeSessionResult> {
        const access = this.sessionCache.resolveSessionAccess(sessionId, namespace)
        if (!access.ok) {
            return {
                type: 'error',
                message: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found',
                code: access.reason === 'access-denied' ? 'access_denied' : 'session_not_found'
            }
        }

        const session = access.session
        if (session.active) {
            return { type: 'success', sessionId: access.sessionId }
        }

        const metadata = session.metadata
        if (!metadata || typeof metadata.path !== 'string') {
            return { type: 'error', message: 'Session metadata missing path', code: 'resume_unavailable' }
        }

        const flavor = metadata.flavor === 'codex' || metadata.flavor === 'gemini' || metadata.flavor === 'opencode' || metadata.flavor === 'cursor'
            ? metadata.flavor
            : 'claude'
        const resumeToken = flavor === 'codex'
            ? metadata.codexSessionId
            : flavor === 'gemini'
                ? metadata.geminiSessionId
                : flavor === 'opencode'
                    ? metadata.opencodeSessionId
                    : flavor === 'cursor'
                        ? metadata.cursorSessionId
                        : metadata.claudeSessionId

        if (!resumeToken) {
            return { type: 'error', message: 'Resume session ID unavailable', code: 'resume_unavailable' }
        }

        const onlineMachines = this.machineCache.getOnlineMachinesByNamespace(namespace)
        if (onlineMachines.length === 0) {
            return { type: 'error', message: 'No machine online', code: 'no_machine_online' }
        }

        const targetMachine = (() => {
            if (metadata.machineId) {
                const exact = onlineMachines.find((machine) => machine.id === metadata.machineId)
                if (exact) return exact
            }
            if (metadata.host) {
                const hostMatch = onlineMachines.find((machine) => machine.metadata?.host === metadata.host)
                if (hostMatch) return hostMatch
            }
            return null
        })()

        if (!targetMachine) {
            return { type: 'error', message: 'No machine online', code: 'no_machine_online' }
        }

        const spawnResult = await this.rpcGateway.spawnSession(
            targetMachine.id,
            metadata.path,
            flavor,
            session.model ?? undefined,
            session.modelReasoningEffort ?? undefined,
            undefined,
            undefined,
            undefined,
            resumeToken,
            session.effort ?? undefined,
            session.permissionMode ?? undefined
        )

        if (spawnResult.type !== 'success') {
            return { type: 'error', message: spawnResult.message, code: 'resume_failed' }
        }

        const becameActive = await this.waitForSessionActive(spawnResult.sessionId)
        if (!becameActive) {
            return { type: 'error', message: 'Session failed to become active', code: 'resume_failed' }
        }

        if (spawnResult.sessionId !== access.sessionId) {
            // The old session may have already been merged by the automatic dedup path
            // (triggered when the spawned CLI sets its agent session ID in metadata).
            // Only attempt the explicit merge if the old session still exists.
            const oldSession = this.sessionCache.getSessionByNamespace(access.sessionId, namespace)
            if (oldSession) {
                try {
                    await this.sessionCache.mergeSessions(access.sessionId, spawnResult.sessionId, namespace)
                } catch (error) {
                    const message = error instanceof Error ? error.message : 'Failed to merge resumed session'
                    return { type: 'error', message, code: 'resume_failed' }
                }
            }
        }

        return { type: 'success', sessionId: spawnResult.sessionId }
    }

    private hasSameAgentSessionIds(
        prev: Session['metadata'] | null,
        next: NonNullable<Session['metadata']>
    ): boolean {
        return (prev?.codexSessionId ?? null) === (next.codexSessionId ?? null)
            && (prev?.claudeSessionId ?? null) === (next.claudeSessionId ?? null)
            && (prev?.geminiSessionId ?? null) === (next.geminiSessionId ?? null)
            && (prev?.opencodeSessionId ?? null) === (next.opencodeSessionId ?? null)
            && (prev?.cursorSessionId ?? null) === (next.cursorSessionId ?? null)
    }

    private triggerDedupIfNeeded(sessionId: string): void {
        const session = this.sessionCache.getSession(sessionId)
        if (session?.metadata) {
            void this.sessionCache.deduplicateByAgentSessionId(sessionId).catch(() => {
                // best-effort: web-side safety net hides remaining duplicates
            })
        }
    }

    async waitForSessionActive(sessionId: string, timeoutMs: number = 15_000): Promise<boolean> {
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
            const session = this.getSession(sessionId)
            if (session?.active) {
                return true
            }
            await new Promise((resolve) => setTimeout(resolve, 250))
        }
        return false
    }

    async checkPathsExist(machineId: string, paths: string[]): Promise<Record<string, boolean>> {
        return await this.rpcGateway.checkPathsExist(machineId, paths)
    }

    async getGitStatus(sessionId: string, cwd?: string): Promise<RpcCommandResponse> {
        return await this.rpcGateway.getGitStatus(sessionId, cwd)
    }

    async getGitDiffNumstat(sessionId: string, options: { cwd?: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.rpcGateway.getGitDiffNumstat(sessionId, options)
    }

    async getGitDiffFile(sessionId: string, options: { cwd?: string; filePath: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.rpcGateway.getGitDiffFile(sessionId, options)
    }

    async readSessionFile(sessionId: string, path: string): Promise<RpcReadFileResponse> {
        return await this.rpcGateway.readSessionFile(sessionId, path)
    }

    async listDirectory(sessionId: string, path: string): Promise<RpcListDirectoryResponse> {
        return await this.rpcGateway.listDirectory(sessionId, path)
    }

    async uploadFile(sessionId: string, filename: string, content: string, mimeType: string): Promise<RpcUploadFileResponse> {
        return await this.rpcGateway.uploadFile(sessionId, filename, content, mimeType)
    }

    async deleteUploadFile(sessionId: string, path: string): Promise<RpcDeleteUploadResponse> {
        return await this.rpcGateway.deleteUploadFile(sessionId, path)
    }

    async runRipgrep(sessionId: string, args: string[], cwd?: string): Promise<RpcCommandResponse> {
        return await this.rpcGateway.runRipgrep(sessionId, args, cwd)
    }

    async listSlashCommands(sessionId: string, agent: string): Promise<{
        success: boolean
        commands?: Array<{ name: string; description?: string; source: 'builtin' | 'user' | 'plugin' | 'project' }>
        error?: string
    }> {
        return await this.rpcGateway.listSlashCommands(sessionId, agent)
    }

    async listSkills(sessionId: string): Promise<{
        success: boolean
        skills?: Array<{ name: string; description?: string }>
        error?: string
    }> {
        return await this.rpcGateway.listSkills(sessionId)
    }

    async listCodexModelsForSession(sessionId: string): Promise<RpcListCodexModelsResponse> {
        return await this.rpcGateway.listCodexModelsForSession(sessionId)
    }

    async listCodexModelsForMachine(machineId: string): Promise<RpcListCodexModelsResponse> {
        return await this.rpcGateway.listCodexModelsForMachine(machineId)
    }

    // --- Channel operations ---

    getChannelsForUser(namespace: string, userId: string): StoredChannel[] {
        return this.channelCache.getChannelsForUser(namespace, userId)
    }

    getChannel(channelId: string, namespace: string): StoredChannel | null {
        return this.channelCache.getChannel(channelId, namespace)
    }

    isChannelMember(channelId: string, userId: string): boolean {
        return this.channelCache.isMember(channelId, userId)
    }

    isPersonalChannel(channelId: string): boolean {
        return this.store.workspaceUsers.isPersonalChannel(channelId)
    }

    createChannel(
        namespace: string,
        name: string,
        createdBy: string,
        description?: string,
        agentConfig?: unknown
    ): StoredChannel {
        const channel = this.store.channels.createChannel(namespace, name, createdBy, description, agentConfig)
        this.channelCache.addChannel(channel)
        // Stage 2: persist agentConfig to file too (if provided)
        if (agentConfig && this.agentConfigStore) {
            try {
                this.agentConfigStore.write(channel.id, agentConfig)
            } catch (err) {
                console.error('[SyncEngine] write agentConfig file failed:', err)
            }
        }
        // Stage 2: auto-spawn channel bot if agentConfig is present.
        // Spawn is async; we don't block channel creation on it.
        if (agentConfig) {
            void this.spawnChannelBot(channel.id, namespace).catch((err) => {
                console.error(`[SyncEngine] auto-spawn bot failed for channel ${channel.id}:`, err)
            })
        }
        return channel
    }

    /**
     * Spawn (or respawn) a channel bot session for the given channel.
     * If `options.resumeSessionId` is provided, the bot resumes from that previous session.
     * Sets channels.bot_session_id on success.
     */
    async spawnChannelBot(
        channelId: string,
        namespace: string,
        options?: { resumeSessionId?: string }
    ): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }> {
        const channel = this.store.channels.getChannel(channelId, namespace)
        if (!channel) {
            return { type: 'error', message: `Channel ${channelId} not found` }
        }
        if (!channel.agentConfig) {
            return { type: 'error', message: `Channel ${channelId} has no agentConfig` }
        }

        // Pick any online machine. Prefer namespace match; fall back to any online.
        const namespaceMachines = this.machineCache.getOnlineMachinesByNamespace(namespace)
        let machine = namespaceMachines[0]
        if (!machine) {
            const anyOnline = this.machineCache.getOnlineMachines()
            machine = anyOnline[0]
        }
        if (!machine) {
            return { type: 'error', message: 'No machine online for channel bot spawn' }
        }

        const cfg = (channel.agentConfig ?? {}) as {
            flavor?: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode'
            model?: string
            botName?: string
        }
        const flavor = cfg.flavor ?? 'claude'
        const model = cfg.model
        const botName = cfg.botName ?? 'Agent'

        const safeName = channel.name.replace(/[^a-zA-Z0-9_-]/g, '_')
        const homeDir = process.env.HAPI_HOME ?? `${process.env.HOME ?? '/tmp'}/.hapi`
        const directory = `${homeDir}/workspaces/${namespace}/${safeName}`

        const result = await this.spawnSession(
            machine.id,
            directory,
            flavor,
            model,
            undefined,
            true, // yolo
            undefined,
            undefined,
            options?.resumeSessionId,
            undefined,
            undefined,
            {
                isChannelBot: true,
                channelId: channel.id,
                botName,
                // Inject channelName into the config blob so the CLI can address the channel by name
                agentConfigJson: JSON.stringify({ ...(channel.agentConfig as object), channelName: channel.name })
            }
        )

        if (result.type === 'success') {
            this.store.channels.setBotSessionId(channelId, namespace, result.sessionId)
            this.channelCache.updateChannel(channelId, namespace)
            console.log(`[SyncEngine] Channel bot spawned: channel=${channelId} session=${result.sessionId}`)
        } else {
            console.error(`[SyncEngine] Channel bot spawn failed for ${channelId}: ${result.message}`)
        }

        return result
    }

    /** Spawn a regular task thread in a channel, called by the channel bot via MCP. */
    async botSpawnThread(
        channelId: string,
        namespace: string,
        botSessionId: string,
        opts: {
            title: string
            prompt: string
            flavor?: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode'
            model?: string
            scheduled?: boolean
            schedule?: string
        }
    ): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }> {
        const channel = this.store.channels.getChannel(channelId, namespace)
        if (!channel) return { type: 'error', message: `Channel ${channelId} not found` }

        // Find an online machine — prefer namespace match, fall back to any
        const namespaceMachines = this.machineCache.getOnlineMachinesByNamespace(namespace)
        let machine = namespaceMachines[0]
        if (!machine) {
            machine = this.machineCache.getOnlineMachines()[0]
        }
        if (!machine) return { type: 'error', message: 'No machine online for thread spawn' }

        const flavor = opts.flavor ?? 'claude'
        const safeChannelName = channel.name.replace(/[^a-zA-Z0-9_-]/g, '_')
        const safeThreadName = opts.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)
        const homeDir = process.env.HAPI_HOME ?? `${process.env.HOME ?? '/tmp'}/.hapi`
        const directory = `${homeDir}/workspaces/${namespace}/${safeChannelName}`

        const result = await this.spawnSession(
            machine.id,
            directory,
            flavor,
            opts.model,
            undefined,
            true, // yolo
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            {
                channelId,
                scheduled: opts.scheduled,
                schedule: opts.schedule
            }
        )

        if (result.type === 'error') return result

        const spawnedId = result.sessionId
        // Attach the new session to the channel
        this.attachSessionToChannel(spawnedId, channelId, namespace, opts.title, botSessionId)

        // For scheduled threads, set the scheduled/pinned/visibility on the session row
        if (opts.scheduled) {
            this.store.sessions.setSessionPinned(spawnedId, namespace, true)
            this.store.sessions.setThreadVisibility(spawnedId, namespace, 'shared')
        }

        // Emit a thread_card so the channel timeline shows the new thread
        this.sendChannelMessage(
            channelId,
            namespace,
            null,
            'thread_card',
            {
                status: 'active',
                taskTitle: opts.title,
                threadId: spawnedId,
                startedAt: Date.now(),
                startedBy: botSessionId,
                scheduled: opts.scheduled === true,
                schedule: opts.schedule ?? null,
                visibility: opts.scheduled ? 'shared' : 'private'
            },
            spawnedId
        )

        // Inject the prompt into the spawned thread (with retry — runner may not be ready yet)
        const trySend = () => this.sendMessage(spawnedId, { text: opts.prompt, sentFrom: 'webapp' })
        try {
            await trySend()
        } catch {
            await new Promise((r) => setTimeout(r, 2000))
            await trySend().catch((err) => {
                console.error('[SyncEngine] Failed to send thread prompt:', err)
            })
        }

        return result
    }

    async botSpawnScheduledThread(
        channelId: string,
        namespace: string,
        botSessionId: string,
        opts: { title: string; prompt: string; schedule: string; flavor?: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode'; model?: string }
    ): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }> {
        // Compose a system-prompt-like prefix that instructs the thread to use /loop
        const wrappedPrompt = `<system>scheduled-task</system>\nYou are a scheduled monitoring thread. Use Claude Code's /loop slash command to run the task below on the schedule "${opts.schedule}". When you observe something noteworthy, call the MCP tool send_to_channel with a brief alert. When nothing has changed, stay silent (do not send anything).\n\nTask:\n${opts.prompt}`
        return this.botSpawnThread(channelId, namespace, botSessionId, {
            title: opts.title,
            prompt: wrappedPrompt,
            flavor: opts.flavor,
            model: opts.model,
            scheduled: true,
            schedule: opts.schedule
        })
    }

    async cancelThreadSession(threadId: string, namespace: string, reason?: string): Promise<void> {
        const session = this.store.sessions.getSessionByNamespace(threadId, namespace)
        if (!session) throw new Error(`Thread ${threadId} not found in namespace ${namespace}`)
        if (!session.channelId) throw new Error(`Session ${threadId} is not a thread`)
        // Mark thread as archived
        this.store.sessions.setThreadStatus(threadId, namespace, 'archived')
        // Best-effort kill the underlying CLI session via RPC
        try {
            await this.rpcGateway.killSession(threadId)
        } catch (err) {
            console.warn(`[SyncEngine] killSession ${threadId} failed (best-effort):`, err)
        }
        // Emit a summary card noting the cancel
        this.sendChannelMessage(
            session.channelId,
            namespace,
            null,
            'agent_summary',
            { status: 'canceled', taskTitle: session.threadTitle, threadId, reason: reason ?? 'canceled by bot' },
            threadId
        )
    }

    setSessionPinned(sessionId: string, namespace: string, pinned: boolean): boolean {
        const ok = this.store.sessions.setSessionPinned(sessionId, namespace, pinned)
        if (ok) {
            const session = this.store.sessions.getSession(sessionId)
            const channelId = session?.channelId
            if (!channelId) {
                throw new Error(`setSessionPinned: session ${sessionId} has no channelId — pin events require channel scoping`)
            }
            // Refresh in-memory cache so subsequent reads (and the
            // session-updated broadcast) reflect the new pinned flag.
            this.sessionCache.refreshSession(sessionId)
            this.eventPublisher.emit({
                type: pinned ? 'thread-pinned' : 'thread-unpinned',
                sessionId,
                channelId,
                namespace
            } as SyncEvent)
        }
        return ok
    }

    setThreadVisibility(sessionId: string, namespace: string, visibility: 'private' | 'shared'): boolean {
        const ok = this.store.sessions.setThreadVisibility(sessionId, namespace, visibility)
        if (ok) {
            const session = this.store.sessions.getSession(sessionId)
            const channelId = session?.channelId
            if (!channelId) {
                throw new Error(`setThreadVisibility: session ${sessionId} has no channelId — visibility events require channel scoping`)
            }
            this.sessionCache.refreshSession(sessionId)
            this.eventPublisher.emit({
                type: 'thread-visibility-changed',
                sessionId,
                channelId,
                namespace,
                visibility
            } as SyncEvent)
        }
        return ok
    }

    toggleMessageReaction(
        messageId: string,
        channelId: string,
        namespace: string,
        reactorRef: string,
        emoji: string
    ): { result: 'added' | 'removed' } {
        const r = this.store.channelMessageReactions.toggle(messageId, reactorRef, emoji)
        this.eventPublisher.emit({
            type: r.result === 'added' ? 'message-reaction-added' : 'message-reaction-removed',
            channelId,
            namespace,
            messageId,
            reactorRef,
            emoji
        } as SyncEvent)
        return { result: r.result }
    }

    addMessageReaction(
        messageId: string,
        channelId: string,
        namespace: string,
        reactorRef: string,
        emoji: string
    ): void {
        this.store.channelMessageReactions.add(messageId, reactorRef, emoji)
        this.eventPublisher.emit({
            type: 'message-reaction-added',
            channelId,
            namespace,
            messageId,
            reactorRef,
            emoji
        } as SyncEvent)
    }

    removeMessageReaction(
        messageId: string,
        channelId: string,
        namespace: string,
        reactorRef: string,
        emoji: string
    ): boolean {
        const removed = this.store.channelMessageReactions.remove(messageId, reactorRef, emoji)
        if (removed) {
            this.eventPublisher.emit({
                type: 'message-reaction-removed',
                channelId,
                namespace,
                messageId,
                reactorRef,
                emoji
            } as SyncEvent)
        }
        return removed
    }

    getReactionsForMessage(messageId: string) {
        return this.store.channelMessageReactions.getForMessage(messageId)
    }

    getReactionsForMessages(messageIds: string[]) {
        return this.store.channelMessageReactions.getForMessages(messageIds)
    }

    updateChannelData(
        channelId: string,
        namespace: string,
        updates: { name?: string; description?: string | null; agentConfig?: unknown | null }
    ): boolean {
        const updated = this.store.channels.updateChannel(channelId, namespace, updates)
        if (updated) {
            this.channelCache.updateChannel(channelId, namespace)
            // Stage 2: mirror agentConfig to file storage so on-disk config stays in sync.
            if (updates.agentConfig !== undefined && this.agentConfigStore) {
                try {
                    if (updates.agentConfig === null) {
                        this.agentConfigStore.delete(channelId)
                    } else {
                        this.agentConfigStore.write(channelId, updates.agentConfig)
                    }
                } catch (err) {
                    console.error('[SyncEngine] mirror agentConfig to file failed:', err)
                }
            }
        }
        return updated
    }

    deleteChannel(channelId: string, namespace: string, options?: { hardDelete?: boolean }): boolean {
        const channel = this.store.channels.getChannel(channelId, namespace)
        if (!channel) return false
        const hard = options?.hardDelete === true

        // Stage 2: archive threads + kill bot session before deleting the row
        const sessions = this.store.sessions.getSessionsByChannel(channelId, namespace)
        for (const s of sessions) {
            if (s.isChannelBot) {
                // Best-effort kill of bot CLI session
                this.rpcGateway.killSession(s.id).catch(() => {/* */})
                this.store.sessions.deleteSession(s.id, namespace)
            } else {
                this.store.sessions.setThreadStatus(s.id, namespace, 'archived')
            }
        }

        this.store.sessions.detachSessionsFromChannel(channelId, namespace)
        const deleted = this.store.channels.deleteChannel(channelId, namespace)
        if (deleted) {
            this.channelCache.removeChannel(channelId, namespace)
        }

        // Stage 2: filesystem cleanup. Always rename to {name}-archived-{ts}; hard
        // mode deletes the renamed folder afterwards.
        try {
            const safeName = channel.name.replace(/[^a-zA-Z0-9_-]/g, '_')
            const homeDir = process.env.HAPI_HOME ?? `${process.env.HOME ?? '/tmp'}/.hapi`
            const dir = `${homeDir}/workspaces/${namespace}/${safeName}`
            const archived = `${dir}-archived-${Date.now()}`
            const fs = require('node:fs') as typeof import('node:fs')
            if (fs.existsSync(dir)) {
                fs.renameSync(dir, archived)
                if (hard) {
                    fs.rmSync(archived, { recursive: true, force: true })
                }
            }
        } catch (err) {
            console.error('[SyncEngine] channel filesystem cleanup failed:', err)
        }

        // Remove agent.json file
        if (this.agentConfigStore) {
            try { this.agentConfigStore.delete(channelId) } catch { /* */ }
        }

        return deleted
    }

    addChannelMember(channelId: string, userId: string, role: string): boolean {
        const added = this.store.channels.addMember(channelId, userId, role)
        if (added) {
            const namespace = this.channelCache.getChannelNamespace(channelId)
            if (namespace) {
                this.channelCache.addMember(channelId, userId, namespace)
            }
        }
        return added
    }

    removeChannelMember(channelId: string, userId: string): boolean {
        const namespace = this.channelCache.getChannelNamespace(channelId)
        const removed = this.store.channels.removeMember(channelId, userId)
        if (removed && namespace) {
            this.channelCache.removeMember(channelId, userId, namespace)
        }
        return removed
    }

    getChannelMembers(channelId: string): StoredChannelMember[] {
        return this.channelCache.getMembers(channelId)
    }

    sendChannelMessage(
        channelId: string,
        namespace: string,
        authorUserId: string | null,
        kind: string,
        body: unknown,
        threadSessionId?: string
    ): StoredChannelMessage {
        const message = this.store.channelMessages.addMessage(channelId, namespace, authorUserId, kind, body, threadSessionId)
        this.eventPublisher.emit({
            type: 'channel-message-received',
            channelId,
            namespace,
            message: {
                id: message.id,
                channelId: message.channelId,
                namespace: message.namespace,
                authorUserId: message.authorUserId,
                kind: message.kind as 'text' | 'thread_card' | 'agent_summary',
                body: message.body,
                threadSessionId: message.threadSessionId,
                createdAt: message.createdAt,
                seq: message.seq
            }
        })
        return message
    }

    getChannelMessages(channelId: string, opts?: { before?: number; limit?: number }): StoredChannelMessage[] {
        return this.store.channelMessages.getMessages(channelId, opts)
    }

    getChannelMessagesSince(channelId: string, afterSeq: number, limit?: number): StoredChannelMessage[] {
        return this.store.channelMessages.getMessagesSince(channelId, afterSeq, limit)
    }

    getSessionsByChannel(channelId: string, namespace: string): Session[] {
        const stored = this.store.sessions.getSessionsByChannel(channelId, namespace)
        const isPersonal = this.store.workspaceUsers.isPersonalChannel(channelId)
        if (isPersonal) {
            const unassigned = this.store.sessions.getUnassignedSessions(namespace)
            const allStored = [...stored, ...unassigned]
            const seen = new Set<string>()
            return allStored
                .filter((s) => { if (seen.has(s.id)) return false; seen.add(s.id); return true })
                .map((s) => this.getSession(s.id))
                .filter((s): s is Session => s !== undefined)
        }
        return stored.map((s) => this.getSession(s.id)).filter((s): s is Session => s !== undefined)
    }

    detachSession(sessionId: string, channelId: string, namespace: string): void {
        this.store.sessions.detachSession(sessionId, channelId, namespace)
        this.sessionCache.refreshSession(sessionId)
    }

    ensureWorkspaceDefaults(
        namespace: string,
        userId: string,
        displayName: string
    ): { personalChannel: { id: string; name: string }; generalChannel: { id: string; name: string } } {
        const result = this.store.workspaceUsers.ensureDefaults(namespace, userId, displayName)
        this.channelCache.reloadAll()
        return result
    }

    attachSessionToChannel(
        sessionId: string,
        channelId: string,
        namespace: string,
        threadTitle: string,
        createdByUserId: string
    ): void {
        const attached = this.store.sessions.attachToChannel(sessionId, namespace, channelId, threadTitle, createdByUserId)
        if (!attached) {
            throw new Error(`Failed to attach session ${sessionId} to channel ${channelId}`)
        }
        this.sessionCache.refreshSession(sessionId)
    }

    createChannelInvite(channelId: string, namespace: string, createdBy: string): { id: string; expiresAt: number } {
        const invite = this.store.channelInvites.createInvite(channelId, namespace, createdBy)
        return { id: invite.id, expiresAt: invite.expiresAt }
    }

    acceptChannelInvite(inviteId: string, userId: string, requesterNamespace: string): { channelId: string; namespace: string } | null {
        const invite = this.store.channelInvites.getInvite(inviteId)
        if (!invite) return null
        if (invite.expiresAt < Date.now()) {
            this.store.channelInvites.deleteInvite(inviteId)
            return null
        }
        if (invite.namespace !== requesterNamespace) return null
        this.addChannelMember(invite.channelId, userId, 'member')
        return { channelId: invite.channelId, namespace: invite.namespace }
    }

    createThreadInChannel(
        channelId: string,
        namespace: string,
        userId: string,
        threadTitle: string,
        metadata?: unknown
    ): Session {
        const tag = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        return this.sessionCache.getOrCreateSession(
            tag,
            metadata ?? { path: '/' },
            null,
            namespace,
            undefined,
            undefined,
            undefined,
            { channelId, threadTitle, createdByUserId: userId }
        )
    }

    updateThreadStatus(sessionId: string, namespace: string, status: 'active' | 'completed' | 'archived'): boolean {
        const session = this.sessionCache.getSessionByNamespace(sessionId, namespace)
        if (!session) return false
        const updated = this.store.sessions.setThreadStatus(sessionId, namespace, status)
        if (updated) {
            this.sessionCache.refreshSession(sessionId)
        }
        return updated
    }

    getOnlineUserIds(namespace: string): string[] {
        return this.sseManager.getOnlineUserIds(namespace)
    }

    getWorkspaceUser(namespace: string, userId: string) {
        return this.store.workspaceUsers.getUser(namespace, userId)
    }
}
