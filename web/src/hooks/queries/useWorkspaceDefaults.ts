import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'

export function useWorkspaceDefaults(api: ApiClient | null, displayName: string) {
    const query = useQuery({
        queryKey: ['workspace-defaults'],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.ensureWorkspaceDefaults(displayName)
        },
        enabled: Boolean(api && displayName),
        staleTime: Infinity,
    })

    return {
        personalChannelId: query.data?.personalChannel?.id ?? null,
        generalChannelId: query.data?.generalChannel?.id ?? null,
        isLoading: query.isLoading,
    }
}
