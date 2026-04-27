export const DEFAULT_NAMESPACE = 'default'

export type ParsedAccessToken = {
    baseToken: string
    namespace: string
    displayName?: string
}

export function parseAccessToken(raw: string): ParsedAccessToken | null {
    if (!raw) {
        return null
    }

    const trimmed = raw.trim()
    if (!trimmed) {
        return null
    }

    const firstColon = trimmed.indexOf(':')
    if (firstColon === -1) {
        return { baseToken: trimmed, namespace: DEFAULT_NAMESPACE }
    }

    const baseToken = trimmed.slice(0, firstColon)
    const rest = trimmed.slice(firstColon + 1)
    if (!baseToken || !rest) {
        return null
    }

    const secondColon = rest.indexOf(':')
    if (secondColon === -1) {
        return { baseToken, namespace: rest }
    }

    const namespace = rest.slice(0, secondColon)
    const displayName = rest.slice(secondColon + 1)
    if (!namespace) {
        return null
    }

    return { baseToken, namespace, displayName: displayName || undefined }
}
