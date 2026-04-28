import type { Database } from 'bun:sqlite'

import type { StoredWorkspaceUser } from './types'
import {
    ensureDefaults,
    getPersonalChannelId,
    getUser,
    getUserGlobal,
    isPersonalChannel,
    setPersonalChannel,
    upsertUser,
    type EnsureDefaultsResult
} from './workspaceUsers'

export class WorkspaceUserStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    upsertUser(namespace: string, userId: string, displayName: string, avatarUrl?: string): StoredWorkspaceUser {
        return upsertUser(this.db, namespace, userId, displayName, avatarUrl)
    }

    getUser(namespace: string, userId: string): StoredWorkspaceUser | null {
        return getUser(this.db, namespace, userId)
    }

    /** Cross-namespace lookup. Use to render authors in shared channels. */
    getUserGlobal(userId: string): StoredWorkspaceUser | null {
        return getUserGlobal(this.db, userId)
    }

    setPersonalChannel(namespace: string, userId: string, channelId: string): void {
        return setPersonalChannel(this.db, namespace, userId, channelId)
    }

    getPersonalChannelId(namespace: string, userId: string): string | null {
        return getPersonalChannelId(this.db, namespace, userId)
    }

    isPersonalChannel(channelId: string): boolean {
        return isPersonalChannel(this.db, channelId)
    }

    ensureDefaults(
        namespace: string,
        userId: string,
        displayName: string,
        defaultAgentConfig?: unknown
    ): EnsureDefaultsResult {
        return ensureDefaults(this.db, namespace, userId, displayName, defaultAgentConfig)
    }
}
