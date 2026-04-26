import type { Database } from 'bun:sqlite'

import type { StoredChannel, StoredChannelMember } from './types'
import {
    addMember,
    createChannel,
    deleteChannel,
    getAllChannels,
    getChannel,
    getChannelByName,
    getChannelsByNamespace,
    getChannelsForUser,
    getMembers,
    isMember,
    removeMember,
    updateChannel
} from './channels'

export class ChannelStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    createChannel(
        namespace: string,
        name: string,
        createdBy: string,
        description?: string,
        agentConfig?: unknown
    ): StoredChannel {
        return createChannel(this.db, namespace, name, createdBy, description, agentConfig)
    }

    getChannel(id: string, namespace: string): StoredChannel | null {
        return getChannel(this.db, id, namespace)
    }

    getAllChannels(): StoredChannel[] {
        return getAllChannels(this.db)
    }

    getChannelsByNamespace(namespace: string): StoredChannel[] {
        return getChannelsByNamespace(this.db, namespace)
    }

    getChannelsForUser(namespace: string, userId: string): StoredChannel[] {
        return getChannelsForUser(this.db, namespace, userId)
    }

    getChannelByName(namespace: string, name: string): StoredChannel | null {
        return getChannelByName(this.db, namespace, name)
    }

    updateChannel(
        id: string,
        namespace: string,
        updates: { name?: string; description?: string | null; agentConfig?: unknown | null }
    ): boolean {
        return updateChannel(this.db, id, namespace, updates)
    }

    deleteChannel(id: string, namespace: string): boolean {
        return deleteChannel(this.db, id, namespace)
    }

    addMember(channelId: string, userId: string, role: string): boolean {
        return addMember(this.db, channelId, userId, role)
    }

    removeMember(channelId: string, userId: string): boolean {
        return removeMember(this.db, channelId, userId)
    }

    getMembers(channelId: string): StoredChannelMember[] {
        return getMembers(this.db, channelId)
    }

    isMember(channelId: string, userId: string): boolean {
        return isMember(this.db, channelId, userId)
    }
}
