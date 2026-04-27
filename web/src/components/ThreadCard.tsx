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
                borderColor: 'var(--app-border)',
                background: 'var(--app-secondary-bg)',
            }}
        >
            <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-medium text-sm truncate" style={{ color: 'var(--app-fg)' }}>
                    {taskTitle}
                </span>
                <span
                    className="text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
                    style={{ color: statusColor, background: `${statusColor}15` }}
                >
                    {statusLabel}
                </span>
            </div>
            <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--app-hint)' }}>
                {startedBy && <span>by {startedBy}</span>}
                {durationMs > 0 && <span>{formatDuration(durationMs)}</span>}
                {todos && todos.total !== undefined && todos.total > 0 && (
                    <span>{todos.completed ?? 0}/{todos.total} done</span>
                )}
            </div>
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
