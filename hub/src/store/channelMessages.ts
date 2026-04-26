import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import type { StoredChannelMessage } from './types'

type DbChannelMessageRow = {
    id: string
    channel_id: string
    namespace: string
    author_user_id: string | null
    kind: string
    body: string
    thread_session_id: string | null
    created_at: number
    seq: number
}

function toStoredChannelMessage(row: DbChannelMessageRow): StoredChannelMessage {
    return {
        id: row.id,
        channelId: row.channel_id,
        namespace: row.namespace,
        authorUserId: row.author_user_id,
        kind: row.kind,
        body: JSON.parse(row.body),
        threadSessionId: row.thread_session_id,
        createdAt: row.created_at,
        seq: row.seq
    }
}

export function addMessage(
    db: Database,
    channelId: string,
    namespace: string,
    authorUserId: string | null,
    kind: string,
    body: unknown,
    threadSessionId?: string
): StoredChannelMessage {
    const id = randomUUID()
    const now = Date.now()
    const bodyJson = JSON.stringify(body)

    db.exec('BEGIN')
    try {
        const seqRow = db.prepare(
            'UPDATE channels SET next_seq = next_seq + 1 WHERE id = @id AND namespace = @namespace RETURNING next_seq'
        ).get({ id: channelId, namespace }) as { next_seq: number } | null

        if (!seqRow) {
            throw new Error(`Channel not found: ${channelId} in namespace ${namespace}`)
        }

        const seq = seqRow.next_seq - 1

        db.prepare(`
            INSERT INTO channel_messages (id, channel_id, namespace, author_user_id, kind, body, thread_session_id, created_at, seq)
            VALUES (@id, @channel_id, @namespace, @author_user_id, @kind, @body, @thread_session_id, @created_at, @seq)
        `).run({
            id,
            channel_id: channelId,
            namespace,
            author_user_id: authorUserId,
            kind,
            body: bodyJson,
            thread_session_id: threadSessionId ?? null,
            created_at: now,
            seq
        })

        db.exec('COMMIT')
    } catch (error) {
        db.exec('ROLLBACK')
        throw error
    }

    const message = db.prepare(
        'SELECT * FROM channel_messages WHERE id = @id'
    ).get({ id }) as DbChannelMessageRow | null

    if (!message) {
        throw new Error(`Failed to create channel message: ${id}`)
    }
    return toStoredChannelMessage(message)
}

export function getMessages(
    db: Database,
    channelId: string,
    opts?: { before?: number; limit?: number }
): StoredChannelMessage[] {
    const limit = Math.max(1, Math.min(200, opts?.limit ?? 50))

    let rows: DbChannelMessageRow[]
    if (opts?.before !== undefined) {
        rows = db.prepare(`
            SELECT * FROM channel_messages
            WHERE channel_id = @channel_id AND seq < @before
            ORDER BY seq DESC LIMIT @limit
        `).all({ channel_id: channelId, before: opts.before, limit }) as DbChannelMessageRow[]
    } else {
        rows = db.prepare(`
            SELECT * FROM channel_messages
            WHERE channel_id = @channel_id
            ORDER BY seq DESC LIMIT @limit
        `).all({ channel_id: channelId, limit }) as DbChannelMessageRow[]
    }

    rows.reverse()
    return rows.map(toStoredChannelMessage)
}

export function getMessagesSince(
    db: Database,
    channelId: string,
    afterSeq: number,
    limit?: number
): StoredChannelMessage[] {
    const clampedLimit = Math.max(1, Math.min(200, limit ?? 50))

    const rows = db.prepare(`
        SELECT * FROM channel_messages
        WHERE channel_id = @channel_id AND seq > @after_seq
        ORDER BY seq ASC LIMIT @limit
    `).all({ channel_id: channelId, after_seq: afterSeq, limit: clampedLimit }) as DbChannelMessageRow[]

    return rows.map(toStoredChannelMessage)
}

export function getMaxSeq(db: Database, channelId: string): number {
    const row = db.prepare(
        'SELECT COALESCE(MAX(seq), 0) AS max_seq FROM channel_messages WHERE channel_id = @channel_id'
    ).get({ channel_id: channelId }) as { max_seq: number }
    return row.max_seq
}
