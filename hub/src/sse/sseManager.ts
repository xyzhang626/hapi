import type { SyncEvent } from '../sync/syncEngine'
import type { VisibilityState } from '../visibility/visibilityTracker'
import type { VisibilityTracker } from '../visibility/visibilityTracker'

export type SSESubscription = {
    id: string
    namespace: string
    userId: string
    all: boolean
    sessionId: string | null
    machineId: string | null
    activeThreadId: string | null
}

type SSEConnection = SSESubscription & {
    send: (event: SyncEvent) => void | Promise<void>
    sendHeartbeat: () => void | Promise<void>
}

export class SSEManager {
    private readonly connections: Map<string, SSEConnection> = new Map()
    private heartbeatTimer: NodeJS.Timeout | null = null
    private readonly heartbeatMs: number
    private readonly visibilityTracker: VisibilityTracker
    private readonly membershipChecker: ((channelId: string, userId: string) => boolean) | null

    constructor(heartbeatMs = 30_000, visibilityTracker: VisibilityTracker, membershipChecker?: (channelId: string, userId: string) => boolean) {
        this.heartbeatMs = heartbeatMs
        this.visibilityTracker = visibilityTracker
        this.membershipChecker = membershipChecker ?? null
    }

    subscribe(options: {
        id: string
        namespace: string
        userId?: string
        all?: boolean
        sessionId?: string | null
        machineId?: string | null
        activeThreadId?: string | null
        visibility?: VisibilityState
        send: (event: SyncEvent) => void | Promise<void>
        sendHeartbeat: () => void | Promise<void>
    }): SSESubscription {
        const subscription: SSEConnection = {
            id: options.id,
            namespace: options.namespace,
            userId: options.userId ?? '',
            all: Boolean(options.all),
            sessionId: options.sessionId ?? null,
            machineId: options.machineId ?? null,
            activeThreadId: options.activeThreadId ?? null,
            send: options.send,
            sendHeartbeat: options.sendHeartbeat
        }

        this.connections.set(subscription.id, subscription)
        this.visibilityTracker.registerConnection(
            subscription.id,
            subscription.namespace,
            options.visibility ?? 'hidden'
        )
        this.ensureHeartbeat()
        return {
            id: subscription.id,
            namespace: subscription.namespace,
            userId: subscription.userId,
            all: subscription.all,
            sessionId: subscription.sessionId,
            machineId: subscription.machineId,
            activeThreadId: subscription.activeThreadId
        }
    }

    unsubscribe(id: string): void {
        this.connections.delete(id)
        this.visibilityTracker.removeConnection(id)
        if (this.connections.size === 0) {
            this.stopHeartbeat()
        }
    }

    updateSubscription(id: string, namespace: string, updates: { activeThreadId?: string | null }): boolean {
        const connection = this.connections.get(id)
        if (!connection || connection.namespace !== namespace) {
            return false
        }
        if (updates.activeThreadId !== undefined) {
            connection.activeThreadId = updates.activeThreadId
        }
        return true
    }

    getOnlineUserIds(namespace: string): string[] {
        const userIds = new Set<string>()
        for (const conn of this.connections.values()) {
            if (conn.namespace === namespace && conn.userId) {
                userIds.add(conn.userId)
            }
        }
        return Array.from(userIds)
    }

    async sendToast(namespace: string, event: Extract<SyncEvent, { type: 'toast' }>): Promise<number> {
        const deliveries: Array<Promise<{ id: string; ok: boolean }>> = []
        for (const connection of this.connections.values()) {
            if (connection.namespace !== namespace) {
                continue
            }
            if (!this.visibilityTracker.isVisibleConnection(connection.id)) {
                continue
            }

            deliveries.push(
                Promise.resolve(connection.send(event))
                    .then(() => ({ id: connection.id, ok: true }))
                    .catch(() => ({ id: connection.id, ok: false }))
            )
        }

        if (deliveries.length === 0) {
            return 0
        }

        const results = await Promise.all(deliveries)
        let successCount = 0
        for (const result of results) {
            if (result.ok) {
                successCount += 1
                continue
            }
            this.unsubscribe(result.id)
        }

        return successCount
    }

    broadcast(event: SyncEvent): void {
        for (const connection of this.connections.values()) {
            if (!this.shouldSend(connection, event)) {
                continue
            }

            void Promise.resolve(connection.send(event)).catch(() => {
                this.unsubscribe(connection.id)
            })
        }
    }

    stop(): void {
        this.stopHeartbeat()
        for (const id of this.connections.keys()) {
            this.visibilityTracker.removeConnection(id)
        }
        this.connections.clear()
    }

    private ensureHeartbeat(): void {
        if (this.heartbeatTimer || this.heartbeatMs <= 0) {
            return
        }

        this.heartbeatTimer = setInterval(() => {
            for (const connection of this.connections.values()) {
                void Promise.resolve(connection.sendHeartbeat()).catch(() => {
                    this.unsubscribe(connection.id)
                })
            }
        }, this.heartbeatMs)
    }

    private stopHeartbeat(): void {
        if (!this.heartbeatTimer) {
            return
        }

        clearInterval(this.heartbeatTimer)
        this.heartbeatTimer = null
    }

    private shouldSend(connection: SSEConnection, event: SyncEvent): boolean {
        // Stage 2: channel-scoped events are gated by membership, not by
        // namespace. A user in ns=bob who joined a channel that lives in
        // ns=alice still must receive its events. Skip the namespace gate
        // entirely for these events and rely on the membership check below.
        const isChannelScopedEvent = event.type === 'channel-added' || event.type === 'channel-updated'
            || event.type === 'channel-removed'
            || event.type === 'channel-message-received' || event.type === 'channel-member-added'
            || event.type === 'channel-member-removed'
            || event.type === 'message-reaction-added' || event.type === 'message-reaction-removed'
            || event.type === 'channel-bot-typing'
            || event.type === 'thread-pinned' || event.type === 'thread-unpinned'
            || event.type === 'thread-visibility-changed'
            || event.type === 'channel-thread-requested'

        if (!isChannelScopedEvent && event.type !== 'connection-changed') {
            const eventNamespace = event.namespace
            if (!eventNamespace || eventNamespace !== connection.namespace) {
                return false
            }
        }

        if (isChannelScopedEvent) {
            if (!connection.userId) return false
            if (event.type === 'channel-member-removed' && event.userId === connection.userId) {
                return true
            }
            if (!this.membershipChecker) return false
            return this.membershipChecker(event.channelId, connection.userId)
        }

        if (event.type === 'message-received') {
            if (connection.all) return true
            if (connection.sessionId === event.sessionId) return true
            if (connection.activeThreadId && connection.activeThreadId === event.sessionId) return true
            return false
        }

        if (event.type === 'connection-changed') {
            return true
        }

        if (connection.all) {
            return true
        }

        if ('sessionId' in event && connection.sessionId === event.sessionId) {
            return true
        }

        if ('sessionId' in event && connection.activeThreadId && connection.activeThreadId === event.sessionId) {
            return true
        }

        if ('machineId' in event && connection.machineId === event.machineId) {
            return true
        }

        return false
    }
}
