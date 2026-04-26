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
