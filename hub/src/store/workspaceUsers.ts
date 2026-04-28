import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import type { StoredWorkspaceUser } from './types'
import { createChannel, getChannelByName, addMember, getChannel } from './channels'

type DbWorkspaceUserRow = {
    id: string
    namespace: string
    user_id: string
    display_name: string
    avatar_url: string | null
    personal_channel_id: string | null
    created_at: number
    last_active_at: number
}

function toStoredWorkspaceUser(row: DbWorkspaceUserRow): StoredWorkspaceUser {
    return {
        id: row.id,
        namespace: row.namespace,
        userId: row.user_id,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        personalChannelId: row.personal_channel_id,
        createdAt: row.created_at,
        lastActiveAt: row.last_active_at
    }
}

export function upsertUser(
    db: Database,
    namespace: string,
    userId: string,
    displayName: string,
    avatarUrl?: string
): StoredWorkspaceUser {
    const now = Date.now()
    const existing = getUser(db, namespace, userId)

    if (existing) {
        db.prepare(`
            UPDATE workspace_users
            SET display_name = @display_name, avatar_url = @avatar_url, last_active_at = @last_active_at
            WHERE namespace = @namespace AND user_id = @user_id
        `).run({
            display_name: displayName,
            avatar_url: avatarUrl ?? existing.avatarUrl,
            last_active_at: now,
            namespace,
            user_id: userId
        })
        return getUser(db, namespace, userId)!
    }

    const id = randomUUID()
    db.prepare(`
        INSERT INTO workspace_users (id, namespace, user_id, display_name, avatar_url, personal_channel_id, created_at, last_active_at)
        VALUES (@id, @namespace, @user_id, @display_name, @avatar_url, NULL, @created_at, @last_active_at)
    `).run({
        id,
        namespace,
        user_id: userId,
        display_name: displayName,
        avatar_url: avatarUrl ?? null,
        created_at: now,
        last_active_at: now
    })

    const user = getUser(db, namespace, userId)
    if (!user) {
        throw new Error(`Failed to create workspace user: ${userId}`)
    }
    return user
}

export function getUser(db: Database, namespace: string, userId: string): StoredWorkspaceUser | null {
    const row = db.prepare(
        'SELECT * FROM workspace_users WHERE namespace = @namespace AND user_id = @user_id'
    ).get({ namespace, user_id: userId }) as DbWorkspaceUserRow | null
    return row ? toStoredWorkspaceUser(row) : null
}

/**
 * Look up a user by userId across all namespaces. The auth layer derives
 * userId from sha256(`${namespace}:${displayName}`).readUInt32BE(0), so the
 * id is effectively globally unique. We use this for rendering cross-ns
 * authors in shared channels — Carol's namespace doesn't have a row for
 * Dave (ns=dave), so the per-ns lookup falls back to raw id; this gives
 * us the displayName from whichever namespace owns the user.
 */
export function getUserGlobal(db: Database, userId: string): StoredWorkspaceUser | null {
    const row = db.prepare(
        'SELECT * FROM workspace_users WHERE user_id = @user_id LIMIT 1'
    ).get({ user_id: userId }) as DbWorkspaceUserRow | null
    return row ? toStoredWorkspaceUser(row) : null
}

export function setPersonalChannel(db: Database, namespace: string, userId: string, channelId: string): void {
    const result = db.prepare(
        'UPDATE workspace_users SET personal_channel_id = @channel_id WHERE namespace = @namespace AND user_id = @user_id'
    ).run({ channel_id: channelId, namespace, user_id: userId })
    if (result.changes !== 1) {
        throw new Error(`Workspace user not found: ${namespace}/${userId}`)
    }
}

export function getPersonalChannelId(db: Database, namespace: string, userId: string): string | null {
    const row = db.prepare(
        'SELECT personal_channel_id FROM workspace_users WHERE namespace = @namespace AND user_id = @user_id'
    ).get({ namespace, user_id: userId }) as { personal_channel_id: string | null } | null
    return row?.personal_channel_id ?? null
}

export function isPersonalChannel(db: Database, channelId: string): boolean {
    const row = db.prepare(
        'SELECT 1 FROM workspace_users WHERE personal_channel_id = @channel_id LIMIT 1'
    ).get({ channel_id: channelId })
    return row !== null
}

export type EnsureDefaultsResult = {
    personalChannel: { id: string; name: string; created: boolean }
    generalChannel: { id: string; name: string; created: boolean }
}

export function ensureDefaults(
    db: Database,
    namespace: string,
    userId: string,
    displayName: string,
    defaultAgentConfig?: unknown
): EnsureDefaultsResult {
    void displayName
    db.exec('BEGIN')
    try {
        // Only set displayName on first creation; subsequent calls just touch last_active_at
        let user = getUser(db, namespace, userId)
        if (user) {
            db.prepare(
                'UPDATE workspace_users SET last_active_at = @now WHERE namespace = @namespace AND user_id = @user_id'
            ).run({ now: Date.now(), namespace, user_id: userId })
            user = getUser(db, namespace, userId)!
        } else {
            user = upsertUser(db, namespace, userId, displayName)
        }

        let generalChannel = getChannelByName(db, namespace, 'general')
        let generalCreated = false
        if (!generalChannel) {
            generalChannel = createChannel(db, namespace, 'general', userId, undefined, defaultAgentConfig)
            generalCreated = true
        }
        addMember(db, generalChannel.id, userId, 'member')

        if (user.personalChannelId) {
            const existing = getChannel(db, user.personalChannelId, namespace)
            if (!existing) {
                throw new Error(
                    `Data corruption: workspace_user ${userId} references missing personal channel ${user.personalChannelId}`
                )
            }
            db.exec('COMMIT')
            return {
                personalChannel: { id: existing.id, name: existing.name, created: false },
                generalChannel: { id: generalChannel.id, name: generalChannel.name, created: generalCreated }
            }
        }

        // Spec: each user's personal channel is literally named "private". Multiple
        // users in the same workspace each have their own row named "private";
        // membership joins ensure they only see their own.
        const personalChannel = createChannel(db, namespace, 'private', userId, undefined, defaultAgentConfig)
        addMember(db, personalChannel.id, userId, 'owner')
        setPersonalChannel(db, namespace, userId, personalChannel.id)

        db.exec('COMMIT')
        return {
            personalChannel: { id: personalChannel.id, name: personalChannel.name, created: true },
            generalChannel: { id: generalChannel.id, name: generalChannel.name, created: generalCreated }
        }
    } catch (error) {
        db.exec('ROLLBACK')
        throw error
    }
}
