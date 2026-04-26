import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import type { StoredChannel, StoredChannelMember } from './types'

type DbChannelRow = {
    id: string
    namespace: string
    name: string
    description: string | null
    agent_config: string | null
    created_by: string
    created_at: number
    updated_at: number
    next_seq: number
}

type DbChannelMemberRow = {
    channel_id: string
    user_id: string
    role: string
    joined_at: number
}

function toStoredChannel(row: DbChannelRow): StoredChannel {
    return {
        id: row.id,
        namespace: row.namespace,
        name: row.name,
        description: row.description,
        agentConfig: row.agent_config ? JSON.parse(row.agent_config) : null,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        nextSeq: row.next_seq
    }
}

function toStoredChannelMember(row: DbChannelMemberRow): StoredChannelMember {
    return {
        channelId: row.channel_id,
        userId: row.user_id,
        role: row.role,
        joinedAt: row.joined_at
    }
}

export function createChannel(
    db: Database,
    namespace: string,
    name: string,
    createdBy: string,
    description?: string,
    agentConfig?: unknown
): StoredChannel {
    const id = randomUUID()
    const now = Date.now()

    db.prepare(`
        INSERT INTO channels (id, namespace, name, description, agent_config, created_by, created_at, updated_at, next_seq)
        VALUES (@id, @namespace, @name, @description, @agent_config, @created_by, @created_at, @updated_at, 1)
    `).run({
        id,
        namespace,
        name,
        description: description ?? null,
        agent_config: agentConfig ? JSON.stringify(agentConfig) : null,
        created_by: createdBy,
        created_at: now,
        updated_at: now
    })

    const channel = getChannel(db, id, namespace)
    if (!channel) {
        throw new Error(`Failed to create channel: ${id}`)
    }
    return channel
}

export function getChannel(db: Database, id: string, namespace: string): StoredChannel | null {
    const row = db.prepare(
        'SELECT * FROM channels WHERE id = @id AND namespace = @namespace'
    ).get({ id, namespace }) as DbChannelRow | null
    return row ? toStoredChannel(row) : null
}

export function getChannelsByNamespace(db: Database, namespace: string): StoredChannel[] {
    const rows = db.prepare(
        'SELECT * FROM channels WHERE namespace = @namespace ORDER BY created_at ASC'
    ).all({ namespace }) as DbChannelRow[]
    return rows.map(toStoredChannel)
}

export function getChannelsForUser(db: Database, namespace: string, userId: string): StoredChannel[] {
    const rows = db.prepare(`
        SELECT c.* FROM channels c
        JOIN channel_members cm ON c.id = cm.channel_id
        WHERE c.namespace = @namespace AND cm.user_id = @userId
        ORDER BY c.created_at ASC
    `).all({ namespace, userId }) as DbChannelRow[]
    return rows.map(toStoredChannel)
}

export function updateChannel(
    db: Database,
    id: string,
    namespace: string,
    updates: { name?: string; description?: string | null; agentConfig?: unknown | null }
): boolean {
    const setClauses: string[] = ['updated_at = @updated_at']
    const params: Record<string, unknown> = {
        id,
        namespace,
        updated_at: Date.now()
    }

    if (updates.name !== undefined) {
        setClauses.push('name = @name')
        params.name = updates.name
    }
    if (updates.description !== undefined) {
        setClauses.push('description = @description')
        params.description = updates.description
    }
    if (updates.agentConfig !== undefined) {
        setClauses.push('agent_config = @agent_config')
        params.agent_config = updates.agentConfig ? JSON.stringify(updates.agentConfig) : null
    }

    const result = db.prepare(`
        UPDATE channels SET ${setClauses.join(', ')}
        WHERE id = @id AND namespace = @namespace
    `).run(params)

    return result.changes === 1
}

export function deleteChannel(db: Database, id: string, namespace: string): boolean {
    const result = db.prepare(
        'DELETE FROM channels WHERE id = @id AND namespace = @namespace'
    ).run({ id, namespace })
    // changes includes cascaded deletes from channel_members and channel_messages
    return result.changes >= 1
}

export function addMember(
    db: Database,
    channelId: string,
    userId: string,
    role: string
): boolean {
    const result = db.prepare(`
        INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, joined_at)
        VALUES (@channel_id, @user_id, @role, @joined_at)
    `).run({
        channel_id: channelId,
        user_id: userId,
        role,
        joined_at: Date.now()
    })
    return result.changes === 1
}

export function removeMember(db: Database, channelId: string, userId: string): boolean {
    const result = db.prepare(
        'DELETE FROM channel_members WHERE channel_id = @channel_id AND user_id = @user_id'
    ).run({ channel_id: channelId, user_id: userId })
    return result.changes === 1
}

export function getMembers(db: Database, channelId: string): StoredChannelMember[] {
    const rows = db.prepare(
        'SELECT * FROM channel_members WHERE channel_id = @channel_id ORDER BY joined_at ASC'
    ).all({ channel_id: channelId }) as DbChannelMemberRow[]
    return rows.map(toStoredChannelMember)
}

export function isMember(db: Database, channelId: string, userId: string): boolean {
    const row = db.prepare(
        'SELECT 1 FROM channel_members WHERE channel_id = @channel_id AND user_id = @user_id LIMIT 1'
    ).get({ channel_id: channelId, user_id: userId })
    return row !== null
}

export function getAllChannels(db: Database): StoredChannel[] {
    const rows = db.prepare(
        'SELECT * FROM channels ORDER BY created_at ASC'
    ).all() as DbChannelRow[]
    return rows.map(toStoredChannel)
}

export function getChannelByName(db: Database, namespace: string, name: string): StoredChannel | null {
    const row = db.prepare(
        'SELECT * FROM channels WHERE namespace = @namespace AND name = @name LIMIT 1'
    ).get({ namespace, name }) as DbChannelRow | null
    return row ? toStoredChannel(row) : null
}
