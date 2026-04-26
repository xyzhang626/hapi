import { useState, useRef, useEffect } from 'react'
import type { ApiClient } from '@/api/client'
import type { ChannelMessage, Channel, Session } from '@/types/api'
import { ThreadCard } from './ThreadCard'

type ChannelViewProps = {
    api: ApiClient
    channel: Channel
    messages: ChannelMessage[]
    sessions?: Session[]
    onOpenThread: (sessionId: string) => void
    onRefresh: () => void
}

export function ChannelView({ api, channel, messages, sessions, onOpenThread, onRefresh }: ChannelViewProps) {
    const [input, setInput] = useState('')
    const [sending, setSending] = useState(false)
    const scrollRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [messages.length])

    const [sendError, setSendError] = useState<string | null>(null)

    const handleSend = async () => {
        if (!input.trim() || sending) return
        setSending(true)
        setSendError(null)
        try {
            await api.sendChannelMessage(channel.id, input.trim())
            setInput('')
            onRefresh()
        } catch (err) {
            setSendError(err instanceof Error ? err.message : 'Failed to send message')
        } finally {
            setSending(false)
        }
    }

    const sortedMessages = [...messages].sort((a, b) => a.seq - b.seq)

    return (
        <div className="flex flex-col h-full">
            <div
                className="px-4 py-3 border-b flex items-center gap-2"
                style={{ borderColor: 'var(--app-border)' }}
            >
                <span className="font-semibold" style={{ color: 'var(--app-fg)' }}>
                    # {channel.name}
                </span>
                {channel.description && (
                    <span className="text-sm" style={{ color: 'var(--app-hint)' }}>
                        — {channel.description}
                    </span>
                )}
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto app-scroll-y px-4 py-3 space-y-3">
                {sessions && sessions.length > 0 && (
                    <div className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--app-hint)' }}>
                            Threads
                        </div>
                        {sessions.map((s) => (
                            <ThreadCard
                                key={s.id}
                                data={{
                                    status: s.threadStatus ?? (s.active ? 'active' : 'completed'),
                                    taskTitle: s.threadTitle ?? s.metadata?.name ?? 'Session',
                                    threadId: s.id,
                                    startedBy: s.createdByUserId ?? '',
                                    durationMs: s.active ? Date.now() - s.createdAt : (s.updatedAt - s.createdAt),
                                }}
                                kind="thread_card"
                                onOpen={() => onOpenThread(s.id)}
                            />
                        ))}
                    </div>
                )}
                {sortedMessages.length === 0 && (!sessions || sessions.length === 0) && (
                    <div className="text-center py-8" style={{ color: 'var(--app-hint)' }}>
                        <p className="text-sm">No messages yet</p>
                        <p className="text-xs mt-1">Send a message or use @agent to start a task</p>
                    </div>
                )}
                {sortedMessages.map((msg) => (
                    <ChannelMessageItem
                        key={msg.id}
                        message={msg}
                        onOpenThread={onOpenThread}
                    />
                ))}
            </div>

            <div className="px-4 py-3 border-t" style={{ borderColor: 'var(--app-border)' }}>
                {sendError && (
                    <div className="text-xs text-red-500 mb-2">{sendError}</div>
                )}
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                        placeholder={`Message #${channel.name}...`}
                        className="flex-1 text-sm px-3 py-2 rounded-lg border"
                        style={{
                            background: 'var(--app-bg)',
                            borderColor: 'var(--app-border)',
                            color: 'var(--app-fg)',
                        }}
                    />
                    <button
                        onClick={handleSend}
                        disabled={sending || !input.trim()}
                        className="px-4 py-2 rounded-lg text-sm font-medium"
                        style={{
                            background: 'var(--app-button)',
                            color: 'var(--app-button-text)',
                            opacity: sending || !input.trim() ? 0.5 : 1,
                        }}
                    >
                        Send
                    </button>
                </div>
            </div>
        </div>
    )
}

function ChannelMessageItem({
    message,
    onOpenThread,
}: {
    message: ChannelMessage
    onOpenThread: (sessionId: string) => void
}) {
    if (message.kind === 'thread_card' || message.kind === 'agent_summary') {
        const cardData = typeof message.body === 'string' ? tryParse(message.body) : message.body
        return (
            <ThreadCard
                data={cardData}
                kind={message.kind}
                onOpen={() => {
                    if (message.threadSessionId) onOpenThread(message.threadSessionId)
                }}
            />
        )
    }

    const bodyText = typeof message.body === 'string'
        ? tryParseText(message.body)
        : String(message.body)

    const authorName = (message as Record<string, unknown>).authorDisplayName as string
        ?? message.authorUserId ?? 'system'

    return (
        <div className="flex gap-2 items-start">
            <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0"
                style={{ background: 'var(--app-subtle-bg)', color: 'var(--app-hint)' }}
            >
                {authorName[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium" style={{ color: 'var(--app-fg)' }}>
                        {authorName}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--app-hint)' }}>
                        {formatTime(message.createdAt)}
                    </span>
                </div>
                <p className="text-sm mt-0.5 whitespace-pre-wrap" style={{ color: 'var(--app-fg)' }}>
                    {bodyText}
                </p>
            </div>
        </div>
    )
}

function tryParse(s: string): Record<string, unknown> {
    try { return JSON.parse(s) } catch { return {} }
}

function tryParseText(s: string): string {
    try {
        const parsed = JSON.parse(s)
        if (typeof parsed === 'string') return parsed
        if (parsed && typeof parsed.text === 'string') return parsed.text
        return s
    } catch {
        return s
    }
}

function formatTime(ts: number): string {
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
