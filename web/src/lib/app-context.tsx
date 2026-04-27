import { createContext, useContext, type ReactNode } from 'react'
import type { ApiClient } from '@/api/client'

type AppContextValue = {
    api: ApiClient
    token: string
    baseUrl: string
    /** Stage 2: current authenticated user id, used for owner checks
     *  (e.g. AgentConfigEditor visibility against channel.createdBy). */
    userId: string | null
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppContextProvider(props: {
    value: AppContextValue
    children: ReactNode
}) {
    return (
        <AppContext.Provider value={props.value}>
            {props.children}
        </AppContext.Provider>
    )
}

export function useAppContext(): AppContextValue {
    const context = useContext(AppContext)
    if (!context) {
        throw new Error('AppContext is not available')
    }
    return context
}
