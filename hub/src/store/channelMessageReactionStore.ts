import type { Database } from 'bun:sqlite'

import type { StoredChannelMessageReaction } from './types'
import {
    addReaction,
    getReactionsForMessage,
    getReactionsForMessages,
    removeReaction,
    toggleReaction,
    type ReactionToggleResult
} from './channelMessageReactions'

export class ChannelMessageReactionStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    add(messageId: string, reactorRef: string, emoji: string): StoredChannelMessageReaction {
        return addReaction(this.db, messageId, reactorRef, emoji)
    }

    remove(messageId: string, reactorRef: string, emoji: string): boolean {
        return removeReaction(this.db, messageId, reactorRef, emoji)
    }

    toggle(messageId: string, reactorRef: string, emoji: string): ReactionToggleResult {
        return toggleReaction(this.db, messageId, reactorRef, emoji)
    }

    getForMessage(messageId: string): StoredChannelMessageReaction[] {
        return getReactionsForMessage(this.db, messageId)
    }

    getForMessages(messageIds: string[]): Map<string, StoredChannelMessageReaction[]> {
        return getReactionsForMessages(this.db, messageIds)
    }
}
