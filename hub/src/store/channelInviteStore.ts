import type { Database } from 'bun:sqlite'
import {
    createInvite,
    getInvite,
    deleteInvite,
    deleteExpiredInvites,
    type StoredChannelInvite
} from './channelInvites'

export class ChannelInviteStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    createInvite(channelId: string, namespace: string, createdBy: string, expiresInMs?: number): StoredChannelInvite {
        return createInvite(this.db, channelId, namespace, createdBy, expiresInMs)
    }

    getInvite(id: string): StoredChannelInvite | null {
        return getInvite(this.db, id)
    }

    deleteInvite(id: string): boolean {
        return deleteInvite(this.db, id)
    }

    deleteExpiredInvites(): number {
        return deleteExpiredInvites(this.db)
    }
}
