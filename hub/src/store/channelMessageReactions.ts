import type { Database } from 'bun:sqlite'

import type { StoredChannelMessageReaction } from './types'

type DbReactionRow = {
    message_id: string
    reactor_ref: string
    emoji: string
    created_at: number
}

function toStored(row: DbReactionRow): StoredChannelMessageReaction {
    return {
        messageId: row.message_id,
        reactorRef: row.reactor_ref,
        emoji: row.emoji,
        createdAt: row.created_at
    }
}

export type ReactionToggleResult =
    | { result: 'added'; reaction: StoredChannelMessageReaction }
    | { result: 'removed' }

export function toggleReaction(
    db: Database,
    messageId: string,
    reactorRef: string,
    emoji: string
): ReactionToggleResult {
    const existing = db.prepare(
        'SELECT * FROM channel_message_reactions WHERE message_id = @message_id AND reactor_ref = @reactor_ref AND emoji = @emoji'
    ).get({ message_id: messageId, reactor_ref: reactorRef, emoji }) as DbReactionRow | null

    if (existing) {
        db.prepare(
            'DELETE FROM channel_message_reactions WHERE message_id = @message_id AND reactor_ref = @reactor_ref AND emoji = @emoji'
        ).run({ message_id: messageId, reactor_ref: reactorRef, emoji })
        return { result: 'removed' }
    }

    const now = Date.now()
    db.prepare(
        `INSERT INTO channel_message_reactions (message_id, reactor_ref, emoji, created_at)
         VALUES (@message_id, @reactor_ref, @emoji, @created_at)`
    ).run({
        message_id: messageId,
        reactor_ref: reactorRef,
        emoji,
        created_at: now
    })

    return {
        result: 'added',
        reaction: { messageId, reactorRef, emoji, createdAt: now }
    }
}

export function addReaction(
    db: Database,
    messageId: string,
    reactorRef: string,
    emoji: string
): StoredChannelMessageReaction {
    const now = Date.now()
    db.prepare(
        `INSERT OR IGNORE INTO channel_message_reactions (message_id, reactor_ref, emoji, created_at)
         VALUES (@message_id, @reactor_ref, @emoji, @created_at)`
    ).run({
        message_id: messageId,
        reactor_ref: reactorRef,
        emoji,
        created_at: now
    })
    const row = db.prepare(
        'SELECT * FROM channel_message_reactions WHERE message_id = @message_id AND reactor_ref = @reactor_ref AND emoji = @emoji'
    ).get({ message_id: messageId, reactor_ref: reactorRef, emoji }) as DbReactionRow
    return toStored(row)
}

export function removeReaction(
    db: Database,
    messageId: string,
    reactorRef: string,
    emoji: string
): boolean {
    const result = db.prepare(
        'DELETE FROM channel_message_reactions WHERE message_id = @message_id AND reactor_ref = @reactor_ref AND emoji = @emoji'
    ).run({ message_id: messageId, reactor_ref: reactorRef, emoji })
    return result.changes === 1
}

export function getReactionsForMessage(
    db: Database,
    messageId: string
): StoredChannelMessageReaction[] {
    const rows = db.prepare(
        'SELECT * FROM channel_message_reactions WHERE message_id = @message_id ORDER BY created_at ASC'
    ).all({ message_id: messageId }) as DbReactionRow[]
    return rows.map(toStored)
}

export function getReactionsForMessages(
    db: Database,
    messageIds: string[]
): Map<string, StoredChannelMessageReaction[]> {
    const out = new Map<string, StoredChannelMessageReaction[]>()
    if (messageIds.length === 0) return out
    const placeholders = messageIds.map(() => '?').join(',')
    const rows = db.prepare(
        `SELECT * FROM channel_message_reactions WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`
    ).all(...messageIds) as DbReactionRow[]
    for (const row of rows) {
        const stored = toStored(row)
        const list = out.get(stored.messageId)
        if (list) list.push(stored)
        else out.set(stored.messageId, [stored])
    }
    return out
}
