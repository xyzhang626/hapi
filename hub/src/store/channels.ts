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
    bot_session_id: string | null
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
        nextSeq: row.next_seq,
        botSessionId: row.bot_session_id
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

/**
 * Look up a channel by id without a namespace filter. Used by Stage 2 paths
 * where the caller (e.g. CLI POST /sessions, channel-bot RPC handlers) only
 * has the channelId and needs to discover the channel's actual namespace —
 * e.g. when an embedded runner in 'default' namespace spawns a bot whose
 * channel lives in another user's namespace.
 */
export function getChannelById(db: Database, id: string): StoredChannel | null {
    const row = db.prepare(
        'SELECT * FROM channels WHERE id = @id'
    ).get({ id }) as DbChannelRow | null
    return row ? toStoredChannel(row) : null
}

export function getChannelsByNamespace(db: Database, namespace: string): StoredChannel[] {
    const rows = db.prepare(
        'SELECT * FROM channels WHERE namespace = @namespace ORDER BY created_at ASC'
    ).all({ namespace }) as DbChannelRow[]
    return rows.map(toStoredChannel)
}

/**
 * Stage 2: list channels where the user is a member, regardless of channel
 * namespace. The earlier single-user model gated by `c.namespace = @namespace`,
 * which made invited cross-namespace members invisible to themselves — Bob
 * accepts an invite to Alice's channel but never sees it because the channel
 * lives in Alice's namespace. Membership is the correct boundary.
 */
export function getChannelsForUser(db: Database, namespace: string, userId: string): StoredChannel[] {
    void namespace
    const rows = db.prepare(`
        SELECT c.* FROM channels c
        JOIN channel_members cm ON c.id = cm.channel_id
        WHERE cm.user_id = @userId
        ORDER BY c.created_at ASC
    `).all({ userId }) as DbChannelRow[]
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
    `).run(params as Record<string, string | number | null>)

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

export function setChannelBotSessionId(
    db: Database,
    channelId: string,
    namespace: string,
    botSessionId: string | null
): boolean {
    const now = Date.now()
    const result = db.prepare(
        `UPDATE channels SET bot_session_id = @bot_session_id, updated_at = @updated_at
         WHERE id = @id AND namespace = @namespace`
    ).run({
        bot_session_id: botSessionId,
        updated_at: now,
        id: channelId,
        namespace
    })
    return result.changes === 1
}
