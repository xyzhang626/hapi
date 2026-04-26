import type { Database } from 'bun:sqlite'

import type { StoredChannelMessage } from './types'
import {
    addMessage,
    getMaxSeq,
    getMessages,
    getMessagesSince
} from './channelMessages'

export class ChannelMessageStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    addMessage(
        channelId: string,
        namespace: string,
        authorUserId: string | null,
        kind: string,
        body: unknown,
        threadSessionId?: string
    ): StoredChannelMessage {
        return addMessage(this.db, channelId, namespace, authorUserId, kind, body, threadSessionId)
    }

    getMessages(channelId: string, opts?: { before?: number; limit?: number }): StoredChannelMessage[] {
        return getMessages(this.db, channelId, opts)
    }

    getMessagesSince(channelId: string, afterSeq: number, limit?: number): StoredChannelMessage[] {
        return getMessagesSince(this.db, channelId, afterSeq, limit)
    }

    getMaxSeq(channelId: string): number {
        return getMaxSeq(this.db, channelId)
    }
}
