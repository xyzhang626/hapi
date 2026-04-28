import type {
    AttachmentMetadata,
    AuthResponse,
    ChannelInviteResponse,
    ChannelMembersResponse,
    ChannelMessagesResponse,
    ChannelResponse,
    ChannelSessionsResponse,
    ChannelsResponse,
    CodexCollaborationMode,
    DeleteUploadResponse,
    ListDirectoryResponse,
    FileReadResponse,
    FileSearchResponse,
    GitCommandResponse,
    MachinePathsExistsResponse,
    MachinesResponse,
    MessagesResponse,
    CodexModelsResponse,
    PermissionMode,
    PushSubscriptionPayload,
    PushUnsubscribePayload,
    PushVapidPublicKeyResponse,
    SlashCommandsResponse,
    SkillsResponse,
    SpawnResponse,
    UploadFileResponse,
    VisibilityPayload,
    SessionResponse,
    SessionsResponse
} from '@/types/api'

type ApiClientOptions = {
    baseUrl?: string
    getToken?: () => string | null
    onUnauthorized?: () => Promise<string | null>
}

type ErrorPayload = {
    error?: unknown
}

function parseErrorCode(bodyText: string): string | undefined {
    try {
        const parsed = JSON.parse(bodyText) as ErrorPayload
        return typeof parsed.error === 'string' ? parsed.error : undefined
    } catch {
        return undefined
    }
}

export class ApiError extends Error {
    status: number
    code?: string
    body?: string

    constructor(message: string, status: number, code?: string, body?: string) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.code = code
        this.body = body
    }
}

export class ApiClient {
    private token: string
    private readonly baseUrl: string | null
    private readonly getToken: (() => string | null) | null
    private readonly onUnauthorized: (() => Promise<string | null>) | null

    constructor(token: string, options?: ApiClientOptions) {
        this.token = token
        this.baseUrl = options?.baseUrl ?? null
        this.getToken = options?.getToken ?? null
        this.onUnauthorized = options?.onUnauthorized ?? null
    }

    private buildUrl(path: string): string {
        if (!this.baseUrl) {
            return path
        }
        try {
            return new URL(path, this.baseUrl).toString()
        } catch {
            return path
        }
    }

    private async request<T>(
        path: string,
        init?: RequestInit,
        attempt: number = 0,
        overrideToken?: string | null
    ): Promise<T> {
        const headers = new Headers(init?.headers)
        const liveToken = this.getToken ? this.getToken() : null
        const authToken = overrideToken !== undefined
            ? (overrideToken ?? (liveToken ?? this.token))
            : (liveToken ?? this.token)
        if (authToken) {
            headers.set('authorization', `Bearer ${authToken}`)
        }
        if (init?.body !== undefined && !headers.has('content-type')) {
            headers.set('content-type', 'application/json')
        }

        const res = await fetch(this.buildUrl(path), {
            ...init,
            headers
        })

        if (res.status === 401) {
            if (attempt === 0 && this.onUnauthorized) {
                const refreshed = await this.onUnauthorized()
                if (refreshed) {
                    this.token = refreshed
                    return await this.request<T>(path, init, attempt + 1, refreshed)
                }
            }
            throw new Error('Session expired. Please sign in again.')
        }

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            throw new Error(`HTTP ${res.status} ${res.statusText}: ${body}`)
        }

        return await res.json() as T
    }

    async authenticate(auth: { initData: string } | { accessToken: string }): Promise<AuthResponse> {
        const res = await fetch(this.buildUrl('/api/auth'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(auth)
        })

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            const code = parseErrorCode(body)
            const detail = body ? `: ${body}` : ''
            throw new ApiError(`Auth failed: HTTP ${res.status} ${res.statusText}${detail}`, res.status, code, body || undefined)
        }

        return await res.json() as AuthResponse
    }

    async bind(auth: { initData: string; accessToken: string }): Promise<AuthResponse> {
        const res = await fetch(this.buildUrl('/api/bind'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(auth)
        })

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            const code = parseErrorCode(body)
            const detail = body ? `: ${body}` : ''
            throw new ApiError(`Bind failed: HTTP ${res.status} ${res.statusText}${detail}`, res.status, code, body || undefined)
        }

        return await res.json() as AuthResponse
    }

    async getSessions(): Promise<SessionsResponse> {
        return await this.request<SessionsResponse>('/api/sessions')
    }

    async getPushVapidPublicKey(): Promise<PushVapidPublicKeyResponse> {
        return await this.request<PushVapidPublicKeyResponse>('/api/push/vapid-public-key')
    }

    async subscribePushNotifications(payload: PushSubscriptionPayload): Promise<void> {
        await this.request('/api/push/subscribe', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async unsubscribePushNotifications(payload: PushUnsubscribePayload): Promise<void> {
        await this.request('/api/push/subscribe', {
            method: 'DELETE',
            body: JSON.stringify(payload)
        })
    }

    async setVisibility(payload: VisibilityPayload): Promise<void> {
        await this.request('/api/visibility', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async getSession(sessionId: string): Promise<SessionResponse> {
        return await this.request<SessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}`)
    }

    async getMessages(sessionId: string, options: { beforeSeq?: number | null; limit?: number }): Promise<MessagesResponse> {
        const params = new URLSearchParams()
        if (options.beforeSeq !== undefined && options.beforeSeq !== null) {
            params.set('beforeSeq', `${options.beforeSeq}`)
        }
        if (options.limit !== undefined && options.limit !== null) {
            params.set('limit', `${options.limit}`)
        }

        const qs = params.toString()
        const url = `/api/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ''}`
        return await this.request<MessagesResponse>(url)
    }

    async getGitStatus(sessionId: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-status`)
    }

    async getGitDiffNumstat(sessionId: string, staged: boolean): Promise<GitCommandResponse> {
        const params = new URLSearchParams()
        params.set('staged', staged ? 'true' : 'false')
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-diff-numstat?${params.toString()}`)
    }

    async getGitDiffFile(sessionId: string, path: string, staged?: boolean): Promise<GitCommandResponse> {
        const params = new URLSearchParams()
        params.set('path', path)
        if (staged !== undefined) {
            params.set('staged', staged ? 'true' : 'false')
        }
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-diff-file?${params.toString()}`)
    }

    async searchSessionFiles(sessionId: string, query: string, limit?: number): Promise<FileSearchResponse> {
        const params = new URLSearchParams()
        if (query) {
            params.set('query', query)
        }
        if (limit !== undefined) {
            params.set('limit', `${limit}`)
        }
        const qs = params.toString()
        return await this.request<FileSearchResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/files${qs ? `?${qs}` : ''}`)
    }

    async readSessionFile(sessionId: string, path: string): Promise<FileReadResponse> {
        const params = new URLSearchParams()
        params.set('path', path)
        return await this.request<FileReadResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/file?${params.toString()}`)
    }

    async listSessionDirectory(sessionId: string, path?: string): Promise<ListDirectoryResponse> {
        const params = new URLSearchParams()
        if (path) {
            params.set('path', path)
        }

        const qs = params.toString()
        return await this.request<ListDirectoryResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/directory${qs ? `?${qs}` : ''}`
        )
    }

    async uploadFile(sessionId: string, filename: string, content: string, mimeType: string): Promise<UploadFileResponse> {
        return await this.request<UploadFileResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/upload`, {
            method: 'POST',
            body: JSON.stringify({ filename, content, mimeType })
        })
    }

    async deleteUploadFile(sessionId: string, path: string): Promise<DeleteUploadResponse> {
        return await this.request<DeleteUploadResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/upload/delete`, {
            method: 'POST',
            body: JSON.stringify({ path })
        })
    }

    async resumeSession(sessionId: string): Promise<string> {
        const response = await this.request<{ sessionId: string }>(
            `/api/sessions/${encodeURIComponent(sessionId)}/resume`,
            { method: 'POST' }
        )
        return response.sessionId
    }

    async sendMessage(sessionId: string, text: string, localId?: string | null, attachments?: AttachmentMetadata[]): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                text,
                localId: localId ?? undefined,
                attachments: attachments ?? undefined
            })
        })
    }

    async abortSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/abort`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async archiveSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/archive`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async switchSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/switch`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/permission-mode`, {
            method: 'POST',
            body: JSON.stringify({ mode })
        })
    }

    async setCollaborationMode(sessionId: string, mode: CodexCollaborationMode): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/collaboration-mode`, {
            method: 'POST',
            body: JSON.stringify({ mode })
        })
    }

    async setModel(sessionId: string, model: string | null): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/model`, {
            method: 'POST',
            body: JSON.stringify({ model })
        })
    }

    async setModelReasoningEffort(sessionId: string, modelReasoningEffort: string | null): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/model-reasoning-effort`, {
            method: 'POST',
            body: JSON.stringify({ modelReasoningEffort })
        })
    }

    async setEffort(sessionId: string, effort: string | null): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/effort`, {
            method: 'POST',
            body: JSON.stringify({ effort })
        })
    }

    async approvePermission(
        sessionId: string,
        requestId: string,
        modeOrOptions?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | {
            mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
            allowTools?: string[]
            decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
            answers?: Record<string, string[]> | Record<string, { answers: string[] }>
        }
    ): Promise<void> {
        const body = typeof modeOrOptions === 'string' || modeOrOptions === undefined
            ? { mode: modeOrOptions }
            : modeOrOptions
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}/approve`, {
            method: 'POST',
            body: JSON.stringify(body)
        })
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        options?: {
            decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
        }
    ): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}/deny`, {
            method: 'POST',
            body: JSON.stringify(options ?? {})
        })
    }

    async getMachines(): Promise<MachinesResponse> {
        return await this.request<MachinesResponse>('/api/machines')
    }

    async checkMachinePathsExists(
        machineId: string,
        paths: string[]
    ): Promise<MachinePathsExistsResponse> {
        return await this.request<MachinePathsExistsResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/paths/exists`,
            {
                method: 'POST',
                body: JSON.stringify({ paths })
            }
        )
    }

    async spawnSession(
        machineId: string,
        directory: string,
        agent?: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode',
        model?: string,
        modelReasoningEffort?: string,
        yolo?: boolean,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string,
        effort?: string
    ): Promise<SpawnResponse> {
        return await this.request<SpawnResponse>(`/api/machines/${encodeURIComponent(machineId)}/spawn`, {
            method: 'POST',
            body: JSON.stringify({ directory, agent, model, modelReasoningEffort, yolo, sessionType, worktreeName, effort })
        })
    }

    async getMachineCodexModels(machineId: string): Promise<CodexModelsResponse> {
        return await this.request<CodexModelsResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/codex-models`
        )
    }

    async getSessionCodexModels(sessionId: string): Promise<CodexModelsResponse> {
        return await this.request<CodexModelsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/codex-models`
        )
    }

    async getSlashCommands(sessionId: string): Promise<SlashCommandsResponse> {
        return await this.request<SlashCommandsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/slash-commands`
        )
    }

    async getSkills(sessionId: string): Promise<SkillsResponse> {
        return await this.request<SkillsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/skills`
        )
    }

    async renameSession(sessionId: string, name: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ name })
        })
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE'
        })
    }

    async fetchVoiceToken(options?: { customAgentId?: string; customApiKey?: string }): Promise<{
        allowed: boolean
        token?: string
        agentId?: string
        error?: string
    }> {
        return await this.request('/api/voice/token', {
            method: 'POST',
            body: JSON.stringify(options || {})
        })
    }

    // --- Channel API ---

    async getChannels(): Promise<ChannelsResponse> {
        return await this.request('/api/channels')
    }

    async getWorkspacePresence(): Promise<{ online: string[] }> {
        return await this.request('/api/workspace/presence')
    }

    async getChannel(channelId: string): Promise<ChannelResponse> {
        return await this.request(`/api/channels/${encodeURIComponent(channelId)}`)
    }

    async createChannel(name: string, description?: string): Promise<ChannelResponse> {
        return await this.request('/api/channels', {
            method: 'POST',
            body: JSON.stringify({ name, description })
        })
    }

    async updateChannel(channelId: string, updates: { name?: string; description?: string | null }): Promise<ChannelResponse> {
        return await this.request(`/api/channels/${encodeURIComponent(channelId)}`, {
            method: 'PUT',
            body: JSON.stringify(updates)
        })
    }

    async deleteChannel(channelId: string, options?: { hard?: boolean }): Promise<void> {
        const qs = options?.hard ? '?hard=true' : ''
        await this.request(`/api/channels/${encodeURIComponent(channelId)}${qs}`, {
            method: 'DELETE'
        })
    }

    async getChannelMembers(channelId: string): Promise<ChannelMembersResponse> {
        return await this.request(`/api/channels/${encodeURIComponent(channelId)}/members`)
    }

    async addChannelMember(channelId: string, userId: string, role?: string): Promise<void> {
        await this.request(`/api/channels/${encodeURIComponent(channelId)}/members`, {
            method: 'POST',
            body: JSON.stringify({ userId, role })
        })
    }

    async removeChannelMember(channelId: string, userId: string): Promise<void> {
        await this.request(`/api/channels/${encodeURIComponent(channelId)}/members/${encodeURIComponent(userId)}`, {
            method: 'DELETE'
        })
    }

    async getChannelMessages(channelId: string, opts?: { before?: number; limit?: number }): Promise<ChannelMessagesResponse> {
        const params = new URLSearchParams()
        if (opts?.before !== undefined) params.set('before', String(opts.before))
        if (opts?.limit !== undefined) params.set('limit', String(opts.limit))
        const qs = params.toString()
        return await this.request(`/api/channels/${encodeURIComponent(channelId)}/messages${qs ? `?${qs}` : ''}`)
    }

    async sendChannelMessage(channelId: string, body: string, kind?: string): Promise<void> {
        await this.request(`/api/channels/${encodeURIComponent(channelId)}/messages`, {
            method: 'POST',
            body: JSON.stringify({ body, kind: kind || 'text' })
        })
    }

    /** Stage 2: toggle a reaction on a channel message (Slack-style toggle). */
    async toggleMessageReaction(channelId: string, messageId: string, emoji: string): Promise<{ result: 'added' | 'removed' }> {
        return await this.request(`/api/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions`, {
            method: 'POST',
            body: JSON.stringify({ emoji })
        })
    }

    /** Stage 2: pin or unpin a thread (channel owner only). */
    async setThreadPinned(sessionId: string, pinned: boolean): Promise<{ ok: boolean }> {
        return await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/pinned`, {
            method: 'PATCH',
            body: JSON.stringify({ pinned })
        })
    }

    /** Stage 2: change thread visibility (creator only). */
    async setThreadVisibility(sessionId: string, visibility: 'private' | 'shared'): Promise<{ ok: boolean }> {
        return await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/visibility`, {
            method: 'PATCH',
            body: JSON.stringify({ visibility })
        })
    }

    /** Stage 2: update channel agentConfig (owner only). */
    async updateChannelAgentConfig(channelId: string, agentConfig: unknown): Promise<{ channel: unknown }> {
        return await this.request(`/api/channels/${encodeURIComponent(channelId)}`, {
            method: 'PUT',
            body: JSON.stringify({ agentConfig })
        })
    }

    /**
     * Stage 2: signal "+ New thread" intent. Hub emits a strong signal
     * that the channel bot picks up; the bot then calls spawn_thread
     * (or similar) via MCP. The actual thread title/flavor are the
     * bot's call.
     */
    async requestNewThread(channelId: string, topic: string): Promise<{ ok: true }> {
        return await this.request(`/api/channels/${encodeURIComponent(channelId)}/thread-request`, {
            method: 'POST',
            body: JSON.stringify({ topic })
        })
    }

    async getChannelSessions(channelId: string): Promise<ChannelSessionsResponse> {
        return await this.request(`/api/channels/${encodeURIComponent(channelId)}/sessions`)
    }

    async createThread(channelId: string, threadTitle: string): Promise<{ session: unknown }> {
        return await this.request(`/api/channels/${encodeURIComponent(channelId)}/sessions`, {
            method: 'POST',
            body: JSON.stringify({ threadTitle })
        })
    }

    async createChannelInvite(channelId: string): Promise<ChannelInviteResponse> {
        return await this.request(`/api/channels/${encodeURIComponent(channelId)}/invite`, {
            method: 'POST'
        })
    }

    async acceptInvite(token: string): Promise<{ channelId: string }> {
        return await this.request(`/api/invite/${encodeURIComponent(token)}`, {
            method: 'POST'
        })
    }

    async ensureWorkspaceDefaults(displayName: string): Promise<{ personalChannel: { id: string; name: string }; generalChannel: { id: string; name: string } }> {
        return await this.request('/api/workspace/ensure-defaults', {
            method: 'POST',
            body: JSON.stringify({ displayName })
        })
    }

    async updateSseSubscription(subscriptionId: string, activeThreadId: string | null): Promise<void> {
        await this.request('/api/sse/subscription', {
            method: 'PATCH',
            body: JSON.stringify({ subscriptionId, activeThreadId })
        })
    }

    async updateThreadStatus(sessionId: string, status: 'active' | 'completed' | 'archived'): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/thread-status`, {
            method: 'PATCH',
            body: JSON.stringify({ status })
        })
    }

    async getSessionRoute(sessionId: string): Promise<{ channelId: string | null }> {
        return await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/route`)
    }
}
