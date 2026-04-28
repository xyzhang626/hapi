import { useState } from 'react'
import type { Channel } from '@/types/api'
import type { ApiClient } from '@/api/client'

type ChannelListProps = {
    api: ApiClient
    channels: Channel[]
    selectedChannelId?: string
    personalChannelId?: string
    onSelectChannel: (channelId: string) => void
}

export function ChannelList({ api, channels, selectedChannelId, personalChannelId, onSelectChannel }: ChannelListProps) {
    const [showCreate, setShowCreate] = useState(false)
    const [newName, setNewName] = useState('')
    const [creating, setCreating] = useState(false)

    const handleCreate = async () => {
        if (!newName.trim() || creating) return
        setCreating(true)
        try {
            const res = await api.createChannel(newName.trim())
            onSelectChannel(res.channel.id)
            setNewName('')
            setShowCreate(false)
        } finally {
            setCreating(false)
        }
    }

    // Spec mvp-user-experience.md sidebar wireframe: separate sections
    // for shared CHANNELS (top) and PRIVATE (bottom). Single flat list
    // mixed the personal channel with shared channels and lost the
    // visual distinction.
    const shared = channels.filter((ch) => ch.id !== personalChannelId)
    const personal = channels.filter((ch) => ch.id === personalChannelId)

    const renderChannelButton = (channel: Channel) => {
        const isSelected = channel.id === selectedChannelId
        return (
            <button
                key={channel.id}
                onClick={() => onSelectChannel(channel.id)}
                className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-1.5 rounded-md mx-1 transition-colors"
                style={{
                    background: isSelected ? 'var(--app-subtle-bg)' : 'transparent',
                    color: isSelected ? 'var(--app-fg)' : 'var(--app-hint)',
                }}
            >
                <span className="opacity-60">#</span>
                <span className="truncate">{channel.name}</span>
            </button>
        )
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto app-scroll-y">
                <div className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--app-hint)' }}>
                    Channels
                </div>
                {shared.map(renderChannelButton)}
                {shared.length === 0 && (
                    <div className="px-3 py-1 text-xs italic" style={{ color: 'var(--app-hint)' }}>
                        No shared channels yet
                    </div>
                )}

                <div className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--app-hint)' }}>
                    Private
                </div>
                {personal.map(renderChannelButton)}
            </div>
            <div className="px-2 pb-2">
                {showCreate ? (
                    <div className="flex gap-1">
                        <input
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                            placeholder="channel name"
                            autoFocus
                            className="flex-1 text-sm px-2 py-1 rounded border"
                            style={{
                                background: 'var(--app-bg)',
                                borderColor: 'var(--app-border)',
                                color: 'var(--app-fg)',
                            }}
                        />
                        <button
                            onClick={handleCreate}
                            disabled={creating || !newName.trim()}
                            className="text-xs px-2 py-1 rounded"
                            style={{ background: 'var(--app-button)', color: 'var(--app-button-text)' }}
                        >
                            +
                        </button>
                        <button
                            onClick={() => { setShowCreate(false); setNewName('') }}
                            className="text-xs px-2 py-1 rounded"
                            style={{ color: 'var(--app-hint)' }}
                        >
                            x
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={() => setShowCreate(true)}
                        className="w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors"
                        style={{ color: 'var(--app-hint)' }}
                    >
                        + Create Channel
                    </button>
                )}
            </div>
        </div>
    )
}
