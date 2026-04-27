import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

import type { StoredSession, ThreadVisibility, VersionedUpdateResult } from './types'
import { safeJsonParse } from './json'
import { updateVersionedField } from './versionedUpdates'

type DbSessionRow = {
    id: string
    tag: string | null
    namespace: string
    machine_id: string | null
    created_at: number
    updated_at: number
    metadata: string | null
    metadata_version: number
    agent_state: string | null
    agent_state_version: number
    model: string | null
    model_reasoning_effort: string | null
    effort: string | null
    todos: string | null
    todos_updated_at: number | null
    team_state: string | null
    team_state_updated_at: number | null
    active: number
    active_at: number | null
    seq: number
    channel_id: string | null
    thread_title: string | null
    thread_status: string | null
    created_by_user_id: string | null
    is_channel_bot: number
    scheduled: number
    schedule: string | null
    pinned: number
    visibility: string
}

function toStoredSession(row: DbSessionRow): StoredSession {
    return {
        id: row.id,
        tag: row.tag,
        namespace: row.namespace,
        machineId: row.machine_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata: safeJsonParse(row.metadata),
        metadataVersion: row.metadata_version,
        agentState: safeJsonParse(row.agent_state),
        agentStateVersion: row.agent_state_version,
        model: row.model,
        modelReasoningEffort: row.model_reasoning_effort,
        effort: row.effort,
        todos: safeJsonParse(row.todos),
        todosUpdatedAt: row.todos_updated_at,
        teamState: safeJsonParse(row.team_state),
        teamStateUpdatedAt: row.team_state_updated_at,
        active: row.active === 1,
        activeAt: row.active_at,
        seq: row.seq,
        channelId: row.channel_id,
        threadTitle: row.thread_title,
        threadStatus: row.thread_status,
        createdByUserId: row.created_by_user_id,
        isChannelBot: row.is_channel_bot === 1,
        scheduled: row.scheduled === 1,
        schedule: row.schedule,
        pinned: row.pinned === 1,
        visibility: (row.visibility === 'shared' ? 'shared' : 'private') as ThreadVisibility
    }
}

export function getOrCreateSession(
    db: Database,
    tag: string,
    metadata: unknown,
    agentState: unknown,
    namespace: string,
    model?: string,
    effort?: string,
    modelReasoningEffort?: string,
    channelOpts?: {
        channelId?: string
        threadTitle?: string
        createdByUserId?: string
        isChannelBot?: boolean
        scheduled?: boolean
        schedule?: string
        pinned?: boolean
        visibility?: ThreadVisibility
    }
): StoredSession {
    const existing = db.prepare(
        'SELECT * FROM sessions WHERE tag = ? AND namespace = ? ORDER BY created_at DESC LIMIT 1'
    ).get(tag, namespace) as DbSessionRow | undefined

    if (existing) {
        return toStoredSession(existing)
    }

    const now = Date.now()
    const id = randomUUID()

    const metadataJson = JSON.stringify(metadata)
    const agentStateJson = agentState === null || agentState === undefined ? null : JSON.stringify(agentState)

    db.prepare(`
        INSERT INTO sessions (
            id, tag, namespace, machine_id, created_at, updated_at,
            metadata, metadata_version,
            agent_state, agent_state_version,
            model,
            model_reasoning_effort,
            effort,
            todos, todos_updated_at,
            active, active_at, seq,
            channel_id, thread_title, thread_status, created_by_user_id,
            is_channel_bot, scheduled, schedule, pinned, visibility
        ) VALUES (
            @id, @tag, @namespace, NULL, @created_at, @updated_at,
            @metadata, 1,
            @agent_state, 1,
            @model,
            @model_reasoning_effort,
            @effort,
            NULL, NULL,
            0, NULL, 0,
            @channel_id, @thread_title, @thread_status, @created_by_user_id,
            @is_channel_bot, @scheduled, @schedule, @pinned, @visibility
        )
    `).run({
        id,
        tag,
        namespace,
        created_at: now,
        updated_at: now,
        metadata: metadataJson,
        agent_state: agentStateJson,
        model: model ?? null,
        model_reasoning_effort: modelReasoningEffort ?? null,
        effort: effort ?? null,
        channel_id: channelOpts?.channelId ?? null,
        thread_title: channelOpts?.threadTitle ?? null,
        thread_status: channelOpts?.channelId ? 'active' : null,
        created_by_user_id: channelOpts?.createdByUserId ?? null,
        is_channel_bot: channelOpts?.isChannelBot ? 1 : 0,
        scheduled: channelOpts?.scheduled ? 1 : 0,
        schedule: channelOpts?.schedule ?? null,
        pinned: channelOpts?.pinned ? 1 : 0,
        visibility: channelOpts?.visibility ?? 'private'
    })

    const row = getSession(db, id)
    if (!row) {
        throw new Error('Failed to create session')
    }
    return row
}

export function updateSessionMetadata(
    db: Database,
    id: string,
    metadata: unknown,
    expectedVersion: number,
    namespace: string,
    options?: { touchUpdatedAt?: boolean }
): VersionedUpdateResult<unknown | null> {
    const now = Date.now()
    const touchUpdatedAt = options?.touchUpdatedAt !== false

    return updateVersionedField({
        db,
        table: 'sessions',
        id,
        namespace,
        field: 'metadata',
        versionField: 'metadata_version',
        expectedVersion,
        value: metadata,
        encode: (value) => {
            const json = JSON.stringify(value)
            return json === undefined ? null : json
        },
        decode: safeJsonParse,
        setClauses: [
            'updated_at = CASE WHEN @touch_updated_at = 1 THEN @updated_at ELSE updated_at END',
            'seq = seq + 1'
        ],
        params: {
            updated_at: now,
            touch_updated_at: touchUpdatedAt ? 1 : 0
        }
    })
}

export function updateSessionAgentState(
    db: Database,
    id: string,
    agentState: unknown,
    expectedVersion: number,
    namespace: string
): VersionedUpdateResult<unknown | null> {
    const now = Date.now()
    const normalized = agentState ?? null

    return updateVersionedField({
        db,
        table: 'sessions',
        id,
        namespace,
        field: 'agent_state',
        versionField: 'agent_state_version',
        expectedVersion,
        value: normalized,
        encode: (value) => (value === null ? null : JSON.stringify(value)),
        decode: safeJsonParse,
        setClauses: ['updated_at = @updated_at', 'seq = seq + 1'],
        params: { updated_at: now }
    })
}

export function setSessionTodos(
    db: Database,
    id: string,
    todos: unknown,
    todosUpdatedAt: number,
    namespace: string
): boolean {
    try {
        const json = todos === null || todos === undefined ? null : JSON.stringify(todos)
        const result = db.prepare(`
            UPDATE sessions
            SET todos = @todos,
                todos_updated_at = @todos_updated_at,
                updated_at = CASE WHEN updated_at > @updated_at THEN updated_at ELSE @updated_at END,
                seq = seq + 1
            WHERE id = @id
              AND namespace = @namespace
              AND (todos_updated_at IS NULL OR todos_updated_at < @todos_updated_at)
        `).run({
            id,
            todos: json,
            todos_updated_at: todosUpdatedAt,
            updated_at: todosUpdatedAt,
            namespace
        })

        return result.changes === 1
    } catch {
        return false
    }
}

export function setSessionTeamState(
    db: Database,
    id: string,
    teamState: unknown,
    updatedAt: number,
    namespace: string
): boolean {
    try {
        const json = teamState === null || teamState === undefined ? null : JSON.stringify(teamState)
        const result = db.prepare(`
            UPDATE sessions
            SET team_state = @team_state,
                team_state_updated_at = @team_state_updated_at,
                updated_at = CASE WHEN updated_at > @updated_at THEN updated_at ELSE @updated_at END,
                seq = seq + 1
            WHERE id = @id
              AND namespace = @namespace
              AND (team_state_updated_at IS NULL OR team_state_updated_at < @team_state_updated_at)
        `).run({
            id,
            team_state: json,
            team_state_updated_at: updatedAt,
            updated_at: updatedAt,
            namespace
        })

        return result.changes === 1
    } catch {
        return false
    }
}

export function setSessionModel(
    db: Database,
    id: string,
    model: string | null,
    namespace: string,
    options?: { touchUpdatedAt?: boolean }
): boolean {
    const now = Date.now()
    const touchUpdatedAt = options?.touchUpdatedAt === true

    try {
        const result = db.prepare(`
            UPDATE sessions
            SET model = @model,
                updated_at = CASE WHEN @touch_updated_at = 1 THEN @updated_at ELSE updated_at END,
                seq = seq + 1
            WHERE id = @id
              AND namespace = @namespace
              AND model IS NOT @model
        `).run({
            id,
            namespace,
            model,
            updated_at: now,
            touch_updated_at: touchUpdatedAt ? 1 : 0
        })

        return result.changes === 1
    } catch {
        return false
    }
}

export function setSessionModelReasoningEffort(
    db: Database,
    id: string,
    modelReasoningEffort: string | null,
    namespace: string,
    options?: { touchUpdatedAt?: boolean }
): boolean {
    const now = Date.now()
    const touchUpdatedAt = options?.touchUpdatedAt === true

    try {
        const result = db.prepare(`
            UPDATE sessions
            SET model_reasoning_effort = @model_reasoning_effort,
                updated_at = CASE WHEN @touch_updated_at = 1 THEN @updated_at ELSE updated_at END,
                seq = seq + 1
            WHERE id = @id
              AND namespace = @namespace
              AND model_reasoning_effort IS NOT @model_reasoning_effort
        `).run({
            id,
            namespace,
            model_reasoning_effort: modelReasoningEffort,
            updated_at: now,
            touch_updated_at: touchUpdatedAt ? 1 : 0
        })

        return result.changes === 1
    } catch {
        return false
    }
}

export function setSessionEffort(
    db: Database,
    id: string,
    effort: string | null,
    namespace: string,
    options?: { touchUpdatedAt?: boolean }
): boolean {
    const now = Date.now()
    const touchUpdatedAt = options?.touchUpdatedAt === true

    try {
        const result = db.prepare(`
            UPDATE sessions
            SET effort = @effort,
                updated_at = CASE WHEN @touch_updated_at = 1 THEN @updated_at ELSE updated_at END,
                seq = seq + 1
            WHERE id = @id
              AND namespace = @namespace
              AND effort IS NOT @effort
        `).run({
            id,
            namespace,
            effort,
            updated_at: now,
            touch_updated_at: touchUpdatedAt ? 1 : 0
        })

        return result.changes === 1
    } catch {
        return false
    }
}

export function touchSessionUpdatedAt(
    db: Database,
    id: string,
    updatedAt: number,
    namespace: string
): boolean {
    try {
        const result = db.prepare(`
            UPDATE sessions
            SET updated_at = @updated_at,
                seq = seq + 1
            WHERE id = @id
              AND namespace = @namespace
              AND updated_at < @updated_at
        `).run({
            id,
            namespace,
            updated_at: updatedAt
        })

        return result.changes === 1
    } catch {
        return false
    }
}

export function getSession(db: Database, id: string): StoredSession | null {
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as DbSessionRow | undefined
    return row ? toStoredSession(row) : null
}

export function getSessionByNamespace(db: Database, id: string, namespace: string): StoredSession | null {
    const row = db.prepare(
        'SELECT * FROM sessions WHERE id = ? AND namespace = ?'
    ).get(id, namespace) as DbSessionRow | undefined
    return row ? toStoredSession(row) : null
}

export function getSessions(db: Database): StoredSession[] {
    const rows = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as DbSessionRow[]
    return rows.map(toStoredSession)
}

export function getSessionsByNamespace(
    db: Database,
    namespace: string,
    opts?: { channelId?: string }
): StoredSession[] {
    if (opts?.channelId) {
        const rows = db.prepare(
            'SELECT * FROM sessions WHERE namespace = ? AND channel_id = ? ORDER BY updated_at DESC'
        ).all(namespace, opts.channelId) as DbSessionRow[]
        return rows.map(toStoredSession)
    }
    const rows = db.prepare(
        'SELECT * FROM sessions WHERE namespace = ? ORDER BY updated_at DESC'
    ).all(namespace) as DbSessionRow[]
    return rows.map(toStoredSession)
}

export function deleteSession(db: Database, id: string, namespace: string): boolean {
    const result = db.prepare(
        'DELETE FROM sessions WHERE id = ? AND namespace = ?'
    ).run(id, namespace)
    return result.changes > 0
}

export function getSessionsByChannel(db: Database, channelId: string, namespace: string): StoredSession[] {
    const rows = db.prepare(
        'SELECT * FROM sessions WHERE channel_id = @channel_id AND namespace = @namespace ORDER BY updated_at DESC'
    ).all({ channel_id: channelId, namespace }) as DbSessionRow[]
    return rows.map(toStoredSession)
}

/**
 * Stage 2: cross-namespace lookup of sessions attached to a channel.
 * Used by channel delete to find bot sessions that may be in a
 * different namespace from the channel (e.g., the embedded runner
 * spawns bot CLIs that auth as 'default' even though the channel
 * is in the user's namespace).
 */
export function getAllSessionsByChannel(db: Database, channelId: string): StoredSession[] {
    const rows = db.prepare(
        'SELECT * FROM sessions WHERE channel_id = @channel_id ORDER BY updated_at DESC'
    ).all({ channel_id: channelId }) as DbSessionRow[]
    return rows.map(toStoredSession)
}

export function detachSessionsFromChannel(db: Database, channelId: string, namespace: string): number {
    const result = db.prepare(
        'UPDATE sessions SET channel_id = NULL WHERE channel_id = @channel_id AND namespace = @namespace'
    ).run({ channel_id: channelId, namespace })
    return result.changes
}

/**
 * Stage 2: cross-namespace detach. See getAllSessionsByChannel above.
 * Channel deletes need this so bot sessions in 'default' namespace
 * are unlinked before the channel row is deleted (otherwise the FK
 * REFERENCES channels(id) ON DELETE RESTRICT trips).
 */
export function detachAllSessionsFromChannel(db: Database, channelId: string): number {
    const result = db.prepare(
        'UPDATE sessions SET channel_id = NULL WHERE channel_id = @channel_id'
    ).run({ channel_id: channelId })
    return result.changes
}

/** Cross-namespace delete used by channel cleanup. */
export function deleteSessionAnyNamespace(db: Database, id: string): boolean {
    const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
    return result.changes > 0
}

export function getUnassignedSessions(db: Database, namespace: string): StoredSession[] {
    const rows = db.prepare(
        'SELECT * FROM sessions WHERE namespace = ? AND channel_id IS NULL ORDER BY updated_at DESC'
    ).all(namespace) as DbSessionRow[]
    return rows.map(toStoredSession)
}

export function detachSession(db: Database, sessionId: string, channelId: string, namespace: string): boolean {
    const result = db.prepare(
        'UPDATE sessions SET channel_id = NULL WHERE id = @id AND namespace = @namespace AND channel_id = @channel_id'
    ).run({ id: sessionId, namespace, channel_id: channelId })
    return result.changes === 1
}

export function setThreadStatus(
    db: Database,
    sessionId: string,
    namespace: string,
    status: 'active' | 'completed' | 'archived'
): boolean {
    const now = Date.now()
    const result = db.prepare(
        'UPDATE sessions SET thread_status = @status, updated_at = @updated_at, seq = seq + 1 WHERE id = @id AND namespace = @namespace'
    ).run({ status, updated_at: now, id: sessionId, namespace })
    return result.changes === 1
}

export function attachToChannel(
    db: Database,
    sessionId: string,
    namespace: string,
    channelId: string,
    threadTitle: string,
    createdByUserId: string
): boolean {
    const now = Date.now()
    const result = db.prepare(
        `UPDATE sessions SET channel_id = @channel_id, thread_title = @thread_title, thread_status = 'active',
         created_by_user_id = @created_by_user_id, updated_at = @updated_at, seq = seq + 1
         WHERE id = @id AND namespace = @namespace`
    ).run({
        channel_id: channelId,
        thread_title: threadTitle,
        created_by_user_id: createdByUserId,
        updated_at: now,
        id: sessionId,
        namespace
    })
    return result.changes === 1
}

export function setSessionPinned(
    db: Database,
    sessionId: string,
    namespace: string,
    pinned: boolean
): boolean {
    const now = Date.now()
    const result = db.prepare(
        `UPDATE sessions SET pinned = @pinned, updated_at = @updated_at, seq = seq + 1
         WHERE id = @id AND namespace = @namespace`
    ).run({
        pinned: pinned ? 1 : 0,
        updated_at: now,
        id: sessionId,
        namespace
    })
    return result.changes === 1
}

export function setThreadVisibility(
    db: Database,
    sessionId: string,
    namespace: string,
    visibility: ThreadVisibility
): boolean {
    const now = Date.now()
    const result = db.prepare(
        `UPDATE sessions SET visibility = @visibility, updated_at = @updated_at, seq = seq + 1
         WHERE id = @id AND namespace = @namespace`
    ).run({
        visibility,
        updated_at: now,
        id: sessionId,
        namespace
    })
    return result.changes === 1
}

export function getChannelBotSessionId(
    db: Database,
    channelId: string,
    namespace: string
): string | null {
    const row = db.prepare(
        `SELECT id FROM sessions
         WHERE channel_id = @channel_id AND namespace = @namespace AND is_channel_bot = 1
         ORDER BY created_at DESC LIMIT 1`
    ).get({ channel_id: channelId, namespace }) as { id: string } | undefined
    return row?.id ?? null
}

export function getAllChannelBotSessions(db: Database): StoredSession[] {
    const rows = db.prepare(
        'SELECT * FROM sessions WHERE is_channel_bot = 1 ORDER BY created_at ASC'
    ).all() as DbSessionRow[]
    return rows.map(toStoredSession)
}
