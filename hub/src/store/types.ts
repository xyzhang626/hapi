export type ThreadVisibility = 'private' | 'shared'

export type StoredSession = {
    id: string
    tag: string | null
    namespace: string
    machineId: string | null
    createdAt: number
    updatedAt: number
    metadata: unknown | null
    metadataVersion: number
    agentState: unknown | null
    agentStateVersion: number
    model: string | null
    modelReasoningEffort: string | null
    effort: string | null
    todos: unknown | null
    todosUpdatedAt: number | null
    teamState: unknown | null
    teamStateUpdatedAt: number | null
    active: boolean
    activeAt: number | null
    seq: number
    channelId: string | null
    threadTitle: string | null
    threadStatus: string | null
    createdByUserId: string | null
    isChannelBot: boolean
    scheduled: boolean
    schedule: string | null
    pinned: boolean
    visibility: ThreadVisibility
}

export type StoredMachine = {
    id: string
    namespace: string
    createdAt: number
    updatedAt: number
    metadata: unknown | null
    metadataVersion: number
    runnerState: unknown | null
    runnerStateVersion: number
    active: boolean
    activeAt: number | null
    seq: number
}

export type StoredMessage = {
    id: string
    sessionId: string
    content: unknown
    createdAt: number
    seq: number
    localId: string | null
}

export type StoredUser = {
    id: number
    platform: string
    platformUserId: string
    namespace: string
    createdAt: number
}

export type StoredPushSubscription = {
    id: number
    namespace: string
    endpoint: string
    p256dh: string
    auth: string
    createdAt: number
}

export type StoredChannel = {
    id: string
    namespace: string
    name: string
    description: string | null
    agentConfig: unknown | null
    createdBy: string
    createdAt: number
    updatedAt: number
    nextSeq: number
    botSessionId: string | null
}

export type StoredChannelMember = {
    channelId: string
    userId: string
    role: string
    joinedAt: number
}

export type StoredChannelMessage = {
    id: string
    channelId: string
    namespace: string
    authorUserId: string | null
    kind: string
    body: unknown
    threadSessionId: string | null
    createdAt: number
    seq: number
}

export type StoredWorkspaceUser = {
    id: string
    namespace: string
    userId: string
    displayName: string
    avatarUrl: string | null
    personalChannelId: string | null
    createdAt: number
    lastActiveAt: number
}

export type StoredChannelMessageReaction = {
    messageId: string
    reactorRef: string
    emoji: string
    createdAt: number
}

export type VersionedUpdateResult<T> =
    | { result: 'success'; version: number; value: T }
    | { result: 'version-mismatch'; version: number; value: T }
    | { result: 'error' }
