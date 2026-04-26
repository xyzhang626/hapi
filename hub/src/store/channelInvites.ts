import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

export type StoredChannelInvite = {
    id: string
    channelId: string
    namespace: string
    createdBy: string
    createdAt: number
    expiresAt: number
}

type DbInviteRow = {
    id: string
    channel_id: string
    namespace: string
    created_by: string
    created_at: number
    expires_at: number
}

function toStoredInvite(row: DbInviteRow): StoredChannelInvite {
    return {
        id: row.id,
        channelId: row.channel_id,
        namespace: row.namespace,
        createdBy: row.created_by,
        createdAt: row.created_at,
        expiresAt: row.expires_at
    }
}

const DEFAULT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

export function createInvite(
    db: Database,
    channelId: string,
    namespace: string,
    createdBy: string,
    expiresInMs: number = DEFAULT_EXPIRY_MS
): StoredChannelInvite {
    const now = Date.now()
    const id = randomUUID()
    db.prepare(`
        INSERT INTO channel_invites (id, channel_id, namespace, created_by, created_at, expires_at)
        VALUES (@id, @channel_id, @namespace, @created_by, @created_at, @expires_at)
    `).run({
        id,
        channel_id: channelId,
        namespace,
        created_by: createdBy,
        created_at: now,
        expires_at: now + expiresInMs
    })
    return { id, channelId, namespace, createdBy, createdAt: now, expiresAt: now + expiresInMs }
}

export function getInvite(db: Database, id: string): StoredChannelInvite | null {
    const row = db.prepare('SELECT * FROM channel_invites WHERE id = ?').get(id) as DbInviteRow | undefined
    if (!row) return null
    return toStoredInvite(row)
}

export function deleteInvite(db: Database, id: string): boolean {
    const result = db.prepare('DELETE FROM channel_invites WHERE id = ?').run(id)
    return result.changes > 0
}

export function deleteExpiredInvites(db: Database): number {
    const result = db.prepare('DELETE FROM channel_invites WHERE expires_at < ?').run(Date.now())
    return result.changes
}
