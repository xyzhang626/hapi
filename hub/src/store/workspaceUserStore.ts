import type { Database } from 'bun:sqlite'

import type { StoredWorkspaceUser } from './types'
import {
    ensureDefaults,
    getPersonalChannelId,
    getUser,
    isPersonalChannel,
    setPersonalChannel,
    upsertUser
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
        displayName: string
    ): { personalChannel: { id: string; name: string }; generalChannel: { id: string; name: string } } {
        return ensureDefaults(this.db, namespace, userId, displayName)
    }
}
