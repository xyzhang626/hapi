import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Channel, Session } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useChannels(api: ApiClient | null) {
    const query = useQuery({
        queryKey: queryKeys.channels,
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getChannels()
        },
        enabled: Boolean(api),
    })

    return {
        channels: query.data?.channels ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : null,
    }
}

export function useChannel(api: ApiClient | null, channelId: string | undefined) {
    const query = useQuery({
        queryKey: queryKeys.channel(channelId ?? ''),
        queryFn: async () => {
            if (!api || !channelId) throw new Error('API unavailable')
            return await api.getChannel(channelId)
        },
        enabled: Boolean(api && channelId),
    })

    return {
        channel: query.data?.channel ?? null,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : null,
    }
}

export function useChannelMessages(api: ApiClient | null, channelId: string | undefined) {
    const query = useQuery({
        queryKey: queryKeys.channelMessages(channelId ?? ''),
        queryFn: async () => {
            if (!api || !channelId) throw new Error('API unavailable')
            return await api.getChannelMessages(channelId, { limit: 50 })
        },
        enabled: Boolean(api && channelId),
    })

    return {
        messages: query.data?.messages ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : null,
        refetch: query.refetch,
    }
}

export function useChannelSessions(api: ApiClient | null, channelId: string | undefined) {
    const query = useQuery({
        queryKey: queryKeys.channelSessions(channelId ?? ''),
        queryFn: async () => {
            if (!api || !channelId) throw new Error('API unavailable')
            return await api.getChannelSessions(channelId)
        },
        enabled: Boolean(api && channelId),
    })

    return {
        sessions: (query.data?.sessions ?? []) as Session[],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : null,
    }
}

/**
 * Stage 2: surface the channel bot's typing-indicator state. Hub emits
 * `channel-bot-typing` events whenever the bot session's `thinking` flag
 * transitions; useSSE writes the latest action string into this query
 * (or null when the bot is idle).
 *
 * Cold-start: if the user opens a channel mid-thinking, no transition
 * fires. Seed the query from the bot session's current `thinking` flag
 * (refetched whenever the channel detail surfaces a botSessionId).
 */
export function useChannelBotTyping(
    api: ApiClient | null,
    channelId: string | undefined,
    botSessionId: string | null | undefined
): string | null {
    const query = useQuery<string | null>({
        queryKey: queryKeys.channelBotTyping(channelId ?? ''),
        queryFn: async () => {
            if (!api || !botSessionId) return null
            try {
                const resp = await api.getSession(botSessionId)
                return resp.session?.thinking ? 'thinking' : null
            } catch {
                return null
            }
        },
        enabled: Boolean(channelId),
        staleTime: 5_000,
        gcTime: Infinity,
    })
    return query.data ?? null
}

