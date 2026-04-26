import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

export function useWorkspaceDefaults(api: ApiClient | null, displayName: string) {
    const queryClient = useQueryClient()
    const query = useQuery({
        queryKey: ['workspace-defaults'],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.ensureWorkspaceDefaults(displayName)
        },
        enabled: Boolean(api && displayName),
        staleTime: Infinity,
    })

    useEffect(() => {
        if (query.data) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.channels })
        }
    }, [query.data, queryClient])

    return {
        personalChannelId: query.data?.personalChannel?.id ?? null,
        generalChannelId: query.data?.generalChannel?.id ?? null,
        isLoading: query.isLoading,
    }
}
