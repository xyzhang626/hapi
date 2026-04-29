type ThreadCardProps = {
    data: Record<string, unknown>
    kind: 'thread_card' | 'agent_summary'
    onOpen: () => void
}

export function ThreadCard({ data, kind, onOpen }: ThreadCardProps) {
    const status = String(data.status ?? 'unknown')
    const taskTitle = String(data.taskTitle ?? 'Task')
    const startedBy = String(data.startedBy ?? '')
    const durationMs = typeof data.durationMs === 'number' ? data.durationMs : 0
    const todos = data.todos as { completed?: number; total?: number } | undefined
    // R19: cancel_thread(threadId, reason?) — bot can pass a reason that lands
    // on the agent_summary card body. Surface it on the cancelled card so users
    // can see WHY a thread was killed without opening the thread page.
    const reason = typeof data.reason === 'string' && data.reason.trim().length > 0
        ? data.reason.trim()
        : null
    // R17: per spec §VII, shared threads get a more prominent visual treatment
    // ("详细" card) vs private's minimal one. We carry `visibility` through from
    // the live session so an after-the-fact "Share to channel" toggle re-renders
    // the timeline card without re-issuing it.
    const isShared = data.visibility === 'shared'

    const isCompleted = status === 'completed'
    const isFailed = status === 'failed'
    // Stage 2: bot's cancel_thread MCP emits agent_summary with status='canceled'
    // (per syncEngine.botCancelThread). Treat the same as a final-state badge,
    // distinct from the default blue "Active" used for in-flight threads.
    const isCanceled = status === 'canceled' || status === 'cancelled'
    const statusColor = isFailed
        ? '#ef4444'
        : isCompleted
            ? '#22c55e'
            : isCanceled
                ? '#94a3b8'
                : '#3b82f6'
    const statusLabel = isFailed
        ? 'Failed'
        : isCompleted
            ? 'Completed'
            : isCanceled
                ? 'Cancelled'
                : 'Active'

    return (
        <div
            className="rounded-lg border p-3 cursor-pointer transition-colors"
            onClick={onOpen}
            style={{
                borderColor: isShared ? '#6366f1' : 'var(--app-border)',
                background: isShared
                    ? 'linear-gradient(135deg, color-mix(in oklab, #6366f1 8%, var(--app-secondary-bg)), var(--app-secondary-bg))'
                    : 'var(--app-secondary-bg)',
                boxShadow: isShared ? '0 0 0 1px rgba(99, 102, 241, 0.25)' : undefined,
            }}
        >
            <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-medium text-sm truncate" style={{ color: 'var(--app-fg)' }}>
                    {taskTitle}
                </span>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    {isShared && (
                        <span
                            className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                            style={{ color: '#6366f1', background: 'rgba(99, 102, 241, 0.12)' }}
                            title="Shared with channel"
                        >
                            🔗 Shared
                        </span>
                    )}
                    <span
                        className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                        style={{ color: statusColor, background: `${statusColor}15` }}
                    >
                        {statusLabel}
                    </span>
                </div>
            </div>
            <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--app-hint)' }}>
                {startedBy && <span>by {startedBy}</span>}
                {durationMs > 0 && <span>{formatDuration(durationMs)}</span>}
                {todos && todos.total !== undefined && todos.total > 0 && (
                    <span>{todos.completed ?? 0}/{todos.total} done</span>
                )}
            </div>
            {isCanceled && reason && (
                <div
                    className="mt-2 text-xs italic px-2 py-1 rounded"
                    style={{
                        color: 'var(--app-hint)',
                        background: 'color-mix(in oklab, #94a3b8 10%, transparent)',
                        borderLeft: '2px solid #94a3b8',
                    }}
                    title="Cancellation reason"
                >
                    Reason: {reason}
                </div>
            )}
            {kind === 'thread_card' && (
                <div className="mt-2 text-xs" style={{ color: 'var(--app-link)' }}>
                    Open Thread →
                </div>
            )}
        </div>
    )
}

function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ${minutes % 60}m`
}
