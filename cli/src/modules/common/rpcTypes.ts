export interface SpawnSessionOptions {
    machineId?: string
    directory: string
    sessionId?: string
    resumeSessionId?: string
    approvedNewDirectoryCreation?: boolean
    agent?: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode'
    model?: string
    effort?: string
    modelReasoningEffort?: string
    yolo?: boolean
    permissionMode?: string
    token?: string
    sessionType?: 'simple' | 'worktree'
    worktreeName?: string
    /** Channel-bot context for the spawned session (Stage 2) */
    isChannelBot?: boolean
    channelId?: string
    botName?: string
    agentConfigJson?: string
    /** Scheduled-thread context (Stage 2) */
    scheduled?: boolean
    schedule?: string
    /** Custom system prompt to inject (Stage 2 — used by channel bot + scheduled threads) */
    customSystemPrompt?: string
}

export type SpawnSessionResult =
    | { type: 'success'; sessionId: string }
    | { type: 'requestToApproveDirectoryCreation'; directory: string }
    | { type: 'error'; errorMessage: string }
