import { useState, useRef, useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import type { ApiClient } from '@/api/client'
import type { ChannelMessage, Channel, Session } from '@/types/api'
import { ThreadCard } from './ThreadCard'
import { AgentConfigEditor } from './AgentConfigEditor'
import { useAppContext } from '@/lib/app-context'

const QUICK_EMOJIS = ['👀', '👍', '🙏', '🤔', '✅', '⏳', '😅']

type ChannelViewProps = {
    api: ApiClient
    channel: Channel
    messages: ChannelMessage[]
    sessions?: Session[]
    onOpenThread: (sessionId: string) => void
    onRefresh: () => void
    /** Stage 2: bot status indicator (e.g. "Agent is thinking...") shown above input */
    botTypingAction?: string | null
}

type ChannelViewMessage = ChannelMessage & {
    reactions?: Array<{ messageId: string; reactorRef: string; emoji: string; createdAt: number }>
    authorDisplayName?: string
}

export function ChannelView({ api, channel, messages, sessions, onOpenThread, onRefresh, botTypingAction }: ChannelViewProps) {
    const { userId } = useAppContext()
    const [showSettings, setShowSettings] = useState(false)
    const isOwner = userId != null && channel.createdBy === userId
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

    const handleReact = async (messageId: string, emoji: string) => {
        try {
            await api.toggleMessageReaction(channel.id, messageId, emoji)
            onRefresh()
        } catch (err) {
            console.error('toggleMessageReaction failed:', err)
        }
    }

    const sortedMessages = ([...messages] as ChannelViewMessage[]).sort((a, b) => a.seq - b.seq)
    const pinnedThreads = (sessions ?? []).filter((s) => (s as any).pinned)
    const channelAny = channel as Channel & { botSessionId?: string | null }

    return (
        <div className="flex flex-col h-full">
            <div
                className="px-4 py-3 border-b"
                style={{ borderColor: 'var(--app-border)' }}
            >
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold" style={{ color: 'var(--app-fg)' }}>
                        # {channel.name}
                    </span>
                    {channel.description && (
                        <span className="text-sm" style={{ color: 'var(--app-hint)' }}>
                            — {channel.description}
                        </span>
                    )}
                    <div className="ml-auto flex items-center gap-3">
                        {channelAny.botSessionId && (
                            <Link
                                to="/sessions/$sessionId"
                                params={{ sessionId: channelAny.botSessionId }}
                                className="text-xs px-2 py-1 rounded-full"
                                style={{
                                    background: 'var(--app-subtle-bg)',
                                    color: 'var(--app-link)',
                                    textDecoration: 'none'
                                }}
                                title="View bot session (read-only)"
                            >
                                ✨ Bot session →
                            </Link>
                        )}
                        <button
                            onClick={() => setShowSettings(true)}
                            className="text-xs px-2 py-1 rounded-full"
                            style={{
                                background: 'var(--app-subtle-bg)',
                                color: 'var(--app-fg)',
                                border: '1px solid var(--app-border)'
                            }}
                            title={isOwner ? 'Edit channel agent settings' : 'View channel agent settings (owner-only edits)'}
                        >
                            ⚙ Settings
                        </button>
                    </div>
                </div>
                {pinnedThreads.length > 0 && (
                    <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                        {pinnedThreads.map((s) => (
                            <button
                                key={s.id}
                                onClick={() => onOpenThread(s.id)}
                                className="text-xs px-2 py-1 rounded-full whitespace-nowrap"
                                style={{
                                    background: 'var(--app-subtle-bg)',
                                    color: 'var(--app-fg)',
                                    border: '1px solid var(--app-border)'
                                }}
                            >
                                {(s as any).scheduled ? '⏰' : '📌'} {s.threadTitle ?? 'thread'}
                            </button>
                        ))}
                    </div>
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
                        onReact={(emoji) => handleReact(msg.id, emoji)}
                    />
                ))}
            </div>

            <div className="px-4 py-2 border-t" style={{ borderColor: 'var(--app-border)' }}>
                {botTypingAction && (
                    <div
                        className="text-xs mb-2 flex items-center gap-2 italic"
                        style={{ color: 'var(--app-hint)' }}
                    >
                        <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--app-link)' }} />
                        ✨ Agent is {botTypingAction}…
                    </div>
                )}
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

            {showSettings && (
                <AgentConfigEditor
                    api={api}
                    channelId={channel.id}
                    initialConfig={(channel.agentConfig ?? null) as Parameters<typeof AgentConfigEditor>[0]['initialConfig']}
                    canEdit={isOwner}
                    onClose={() => setShowSettings(false)}
                    onSaved={() => {
                        // Channel updates flow back through SSE channel-updated and
                        // the channels query invalidation in useSSE.
                        onRefresh()
                    }}
                />
            )}
        </div>
    )
}

function ChannelMessageItem({
    message,
    onOpenThread,
    onReact,
}: {
    message: ChannelViewMessage
    onOpenThread: (sessionId: string) => void
    onReact: (emoji: string) => void
}) {
    const [showPicker, setShowPicker] = useState(false)
    if (message.kind === 'thread_card' || message.kind === 'agent_summary') {
        const cardData = (typeof message.body === 'string' ? tryParse(message.body) : message.body) as Record<string, unknown>
        return (
            <div>
                <ThreadCard
                    data={cardData}
                    kind={message.kind}
                    onOpen={() => {
                        if (message.threadSessionId) onOpenThread(message.threadSessionId)
                    }}
                />
                <ReactionRow message={message} onReact={onReact} showPicker={showPicker} setShowPicker={setShowPicker} />
            </div>
        )
    }

    const bodyAny = typeof message.body === 'string' ? tryParse(message.body) : message.body as Record<string, unknown>
    const bodyText = typeof message.body === 'string'
        ? tryParseText(message.body)
        : (typeof bodyAny?.text === 'string' ? (bodyAny.text as string) : String(message.body))
    const fromBot = bodyAny && (bodyAny as { fromBot?: boolean }).fromBot === true

    const authorName = (message as Record<string, unknown>).authorDisplayName as string
        ?? (fromBot ? 'Agent' : (message.authorUserId ?? 'system'))

    return (
        <div className="flex gap-2 items-start group">
            <div
                className="w-8 h-8 flex items-center justify-center text-xs font-medium flex-shrink-0"
                style={{
                    background: fromBot ? 'linear-gradient(135deg, var(--app-link), var(--app-button))' : 'var(--app-subtle-bg)',
                    color: fromBot ? '#fff' : 'var(--app-hint)',
                    borderRadius: fromBot ? '6px' : '999px'
                }}
                title={fromBot ? 'AI agent' : 'user'}
            >
                {fromBot ? '✨' : (authorName[0]?.toUpperCase() ?? '?')}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium" style={{ color: 'var(--app-fg)' }}>
                        {authorName}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--app-hint)' }}>
                        {formatTime(message.createdAt)}
                    </span>
                    <button
                        onClick={() => setShowPicker((s) => !s)}
                        className="ml-auto opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity text-xs px-1.5 py-0.5 rounded"
                        style={{ color: 'var(--app-hint)' }}
                        title="React"
                    >
                        + 😊
                    </button>
                </div>
                <p className="text-sm mt-0.5 whitespace-pre-wrap" style={{ color: 'var(--app-fg)' }}>
                    {bodyText}
                </p>
                <ReactionRow message={message} onReact={onReact} showPicker={showPicker} setShowPicker={setShowPicker} />
            </div>
        </div>
    )
}

function ReactionRow({
    message,
    onReact,
    showPicker,
    setShowPicker,
}: {
    message: ChannelViewMessage
    onReact: (emoji: string) => void
    showPicker: boolean
    setShowPicker: (b: boolean) => void
}) {
    const reactions = message.reactions ?? []
    // Group by emoji
    const grouped = new Map<string, number>()
    for (const r of reactions) {
        grouped.set(r.emoji, (grouped.get(r.emoji) ?? 0) + 1)
    }
    if (grouped.size === 0 && !showPicker) return null
    return (
        <div className="flex gap-1 mt-1.5 flex-wrap items-center">
            {[...grouped.entries()].map(([emoji, count]) => (
                <button
                    key={emoji}
                    onClick={() => onReact(emoji)}
                    className="text-xs px-2 py-0.5 rounded-full hover:scale-105 transition-transform"
                    style={{
                        background: 'var(--app-subtle-bg)',
                        color: 'var(--app-fg)',
                        border: '1px solid var(--app-border)'
                    }}
                >
                    {emoji} {count > 1 ? count : ''}
                </button>
            ))}
            {showPicker && (
                <div
                    className="flex gap-1 items-center px-2 py-1 rounded-lg"
                    style={{
                        background: 'var(--app-bg)',
                        border: '1px solid var(--app-border)'
                    }}
                >
                    {QUICK_EMOJIS.map((e) => (
                        <button
                            key={e}
                            onClick={() => { onReact(e); setShowPicker(false) }}
                            className="hover:scale-125 transition-transform text-base"
                        >
                            {e}
                        </button>
                    ))}
                    <button onClick={() => setShowPicker(false)} className="text-xs ml-1" style={{ color: 'var(--app-hint)' }}>×</button>
                </div>
            )}
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
