import type { SyncEvent } from '@hapi/protocol/types'
import type { SyncEngine } from './syncEngine'

type TaskEntry = {
    channelId: string
    namespace: string
    userId: string
    taskTitle: string
    messageBody: string
    sessionId?: string
    startedAt?: number
}

type ChannelQueue = {
    active: Map<string, TaskEntry>
    queue: TaskEntry[]
}

const MAX_ACTIVE_PER_CHANNEL = 2
const MAX_QUEUED_PER_CHANNEL = 20

export class ChannelAgent {
    private readonly channels: Map<string, ChannelQueue> = new Map()
    private unsubscribe: (() => void) | null = null

    constructor(
        private readonly engine: SyncEngine
    ) {
        this.unsubscribe = engine.subscribe((event) => this.handleEvent(event))
    }

    stop(): void {
        if (this.unsubscribe) {
            this.unsubscribe()
            this.unsubscribe = null
        }
    }

    private handleEvent(event: SyncEvent): void {
        if (event.type === 'channel-message-received') {
            this.handleChannelMessage(event)
        } else if (event.type === 'session-updated') {
            this.handleSessionUpdate(event)
        }
    }

    private handleChannelMessage(event: Extract<SyncEvent, { type: 'channel-message-received' }>): void {
        const message = event.message
        if (message.kind !== 'text') return

        const body = typeof message.body === 'string' ? message.body : JSON.stringify(message.body)
        if (!body.includes('@agent')) return

        const taskTitle = this.extractTaskTitle(body)
        const entry: TaskEntry = {
            channelId: event.channelId,
            namespace: event.namespace ?? '',
            userId: message.authorUserId ?? '',
            taskTitle,
            messageBody: body
        }

        this.enqueue(entry)
    }

    private handleSessionUpdate(event: Extract<SyncEvent, { type: 'session-updated' }>): void {
        const sessionId = event.sessionId
        const session = this.engine.getSession(sessionId)
        if (!session?.channelId) return

        const queue = this.channels.get(session.channelId)
        if (!queue) return

        const task = queue.active.get(sessionId)
        if (!task) return

        if (!session.active && task.startedAt) {
            this.completeTask(task, session)
        }
    }

    private enqueue(entry: TaskEntry): void {
        let queue = this.channels.get(entry.channelId)
        if (!queue) {
            queue = { active: new Map(), queue: [] }
            this.channels.set(entry.channelId, queue)
        }

        if (queue.active.size < MAX_ACTIVE_PER_CHANNEL) {
            this.startTask(entry, queue)
        } else if (queue.queue.length < MAX_QUEUED_PER_CHANNEL) {
            queue.queue.push(entry)
        }
    }

    private async startTask(entry: TaskEntry, queue: ChannelQueue): Promise<void> {
        const channel = this.engine.getChannel(entry.channelId, entry.namespace)
        if (!channel) return

        const agentConfig = channel.agentConfig as { flavor?: string; model?: string; systemPrompt?: string } | null
        const flavor = (agentConfig?.flavor ?? 'claude') as 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode'

        const machines = this.engine.getMachinesByNamespace(entry.namespace)
        const onlineMachine = machines.find((m) => m.online)
        if (!onlineMachine) return

        const metadata = onlineMachine.metadata as { path?: string } | null
        const directory = metadata?.path ?? '/'

        entry.startedAt = Date.now()

        const taskPrompt = entry.messageBody.replace(/@agent/gi, '').trim()

        try {
            const result = await this.engine.spawnSession(
                onlineMachine.id,
                directory,
                flavor,
                agentConfig?.model
            )

            if (result.type === 'error') {
                this.releaseTask(entry, queue, 'spawn_failed')
                return
            }

            const spawnedId = result.sessionId
            entry.sessionId = spawnedId
            queue.active.set(spawnedId, entry)

            // Attach the spawned session to the channel so handleSessionUpdate can find it
            this.engine.attachSessionToChannel(spawnedId, entry.channelId, entry.namespace, entry.taskTitle, entry.userId)

            this.engine.sendChannelMessage(
                entry.channelId,
                entry.namespace,
                null,
                'thread_card',
                {
                    status: 'active',
                    taskTitle: entry.taskTitle,
                    threadId: spawnedId,
                    startedAt: entry.startedAt,
                    startedBy: entry.userId
                },
                spawnedId
            )

            if (taskPrompt) {
                // The spawned session may not be ready to receive messages immediately.
                // Retry once after a short delay if the first attempt fails.
                const trySend = () => this.engine.sendMessage(spawnedId, {
                    text: taskPrompt,
                    sentFrom: 'webapp'
                })
                try {
                    await trySend()
                } catch {
                    await new Promise((r) => setTimeout(r, 2000))
                    await trySend().catch((err) => {
                        console.error('[ChannelAgent] Failed to send task prompt:', err)
                    })
                }
            }
        } catch {
            this.releaseTask(entry, queue, 'spawn_failed')
        }
    }

    private releaseTask(entry: TaskEntry, queue: ChannelQueue, reason: string): void {
        if (entry.sessionId) {
            queue.active.delete(entry.sessionId)
        }
        this.engine.sendChannelMessage(
            entry.channelId,
            entry.namespace,
            null,
            'agent_summary',
            {
                status: 'failed',
                taskTitle: entry.taskTitle,
                reason,
                startedBy: entry.userId
            },
            entry.sessionId
        )
        this.drainQueue(entry.channelId)
    }

    private completeTask(
        task: TaskEntry,
        session: { id: string; todos?: unknown; active: boolean; createdAt: number }
    ): void {
        const queue = this.channels.get(task.channelId)
        if (!queue) return

        queue.active.delete(session.id)

        const todos = this.extractTodoSummary(session.todos)
        const durationMs = task.startedAt ? Date.now() - task.startedAt : 0

        this.engine.sendChannelMessage(
            task.channelId,
            task.namespace,
            null,
            'agent_summary',
            {
                status: 'completed',
                taskTitle: task.taskTitle,
                threadId: session.id,
                durationMs,
                todos,
                startedBy: task.userId
            },
            session.id
        )

        this.drainQueue(task.channelId)
    }

    private drainQueue(channelId: string): void {
        const queue = this.channels.get(channelId)
        if (!queue) return

        while (queue.active.size < MAX_ACTIVE_PER_CHANNEL && queue.queue.length > 0) {
            const next = queue.queue.shift()!
            this.startTask(next, queue)
        }
    }

    private extractTaskTitle(body: string): string {
        const cleaned = body.replace(/@agent/gi, '').trim()
        const firstLine = cleaned.split('\n')[0] ?? ''
        const title = firstLine.slice(0, 100).trim()
        return title || 'Agent task'
    }

    private extractTodoSummary(todos: unknown): { completed: number; total: number } {
        if (!todos || !Array.isArray(todos)) {
            return { completed: 0, total: 0 }
        }
        let completed = 0
        let total = 0
        for (const todo of todos) {
            if (typeof todo === 'object' && todo !== null) {
                total++
                if ('status' in todo && (todo as { status: string }).status === 'completed') {
                    completed++
                }
            }
        }
        return { completed, total }
    }
}
