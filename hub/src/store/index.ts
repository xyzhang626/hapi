import { Database } from 'bun:sqlite'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'

import { ChannelMessageStore } from './channelMessageStore'
import { ChannelMessageReactionStore } from './channelMessageReactionStore'
import { ChannelStore } from './channelStore'
import { ChannelInviteStore } from './channelInviteStore'
import { MachineStore } from './machineStore'
import { MessageStore } from './messageStore'
import { PushStore } from './pushStore'
import { SessionStore } from './sessionStore'
import { UserStore } from './userStore'
import { WorkspaceUserStore } from './workspaceUserStore'

export type {
    StoredChannel,
    StoredChannelMember,
    StoredChannelMessage,
    StoredChannelMessageReaction,
    StoredMachine,
    StoredMessage,
    StoredPushSubscription,
    StoredSession,
    StoredUser,
    StoredWorkspaceUser,
    ThreadVisibility,
    VersionedUpdateResult
} from './types'
export { ChannelMessageStore } from './channelMessageStore'
export { ChannelMessageReactionStore } from './channelMessageReactionStore'
export { ChannelStore } from './channelStore'
export { ChannelInviteStore } from './channelInviteStore'
export { MachineStore } from './machineStore'
export { MessageStore } from './messageStore'
export { PushStore } from './pushStore'
export { SessionStore } from './sessionStore'
export { UserStore } from './userStore'
export { WorkspaceUserStore } from './workspaceUserStore'

const SCHEMA_VERSION: number = 10
const REQUIRED_TABLES = [
    'sessions',
    'machines',
    'messages',
    'users',
    'push_subscriptions',
    'channels',
    'channel_members',
    'channel_messages',
    'channel_message_reactions',
    'workspace_users',
    'channel_invites'
] as const

export class Store {
    private db: Database
    private readonly dbPath: string

    readonly sessions: SessionStore
    readonly machines: MachineStore
    readonly messages: MessageStore
    readonly users: UserStore
    readonly push: PushStore
    readonly channels: ChannelStore
    readonly channelMessages: ChannelMessageStore
    readonly channelMessageReactions: ChannelMessageReactionStore
    readonly channelInvites: ChannelInviteStore
    readonly workspaceUsers: WorkspaceUserStore

    constructor(dbPath: string) {
        this.dbPath = dbPath
        if (dbPath !== ':memory:' && !dbPath.startsWith('file::memory:')) {
            const dir = dirname(dbPath)
            mkdirSync(dir, { recursive: true, mode: 0o700 })
            try {
                chmodSync(dir, 0o700)
            } catch {
            }

            if (!existsSync(dbPath)) {
                try {
                    const fd = openSync(dbPath, 'a', 0o600)
                    closeSync(fd)
                } catch {
                }
            }
        }

        this.db = new Database(dbPath, { create: true, readwrite: true, strict: true })
        this.db.exec('PRAGMA journal_mode = WAL')
        this.db.exec('PRAGMA synchronous = NORMAL')
        this.db.exec('PRAGMA foreign_keys = ON')
        this.db.exec('PRAGMA busy_timeout = 5000')
        this.initSchema()

        if (dbPath !== ':memory:' && !dbPath.startsWith('file::memory:')) {
            for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
                try {
                    chmodSync(path, 0o600)
                } catch {
                }
            }
        }

        this.sessions = new SessionStore(this.db)
        this.machines = new MachineStore(this.db)
        this.messages = new MessageStore(this.db)
        this.users = new UserStore(this.db)
        this.push = new PushStore(this.db)
        this.channels = new ChannelStore(this.db)
        this.channelMessages = new ChannelMessageStore(this.db)
        this.channelMessageReactions = new ChannelMessageReactionStore(this.db)
        this.channelInvites = new ChannelInviteStore(this.db)
        this.workspaceUsers = new WorkspaceUserStore(this.db)
    }

    private initSchema(): void {
        const currentVersion = this.getUserVersion()
        if (currentVersion === 0) {
            if (this.hasAnyUserTables()) {
                this.migrateLegacySchemaIfNeeded()
                this.createSchema()
                this.setUserVersion(SCHEMA_VERSION)
                return
            }

            this.createSchema()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 1 && SCHEMA_VERSION === 2) {
            this.migrateFromV1ToV2()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 2 && SCHEMA_VERSION === 3) {
            this.migrateFromV2ToV3()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 3 && SCHEMA_VERSION === 4) {
            this.migrateFromV3ToV4()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 4 && SCHEMA_VERSION === 5) {
            this.migrateFromV4ToV5()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 5 && SCHEMA_VERSION === 6) {
            this.migrateFromV5ToV6()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 6 && SCHEMA_VERSION === 7) {
            this.migrateFromV6ToV7()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 7 && SCHEMA_VERSION === 9) {
            this.migrateFromV7ToV8()
            this.migrateFromV8ToV9()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 8 && SCHEMA_VERSION === 9) {
            this.migrateFromV8ToV9()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 9 && SCHEMA_VERSION === 10) {
            this.migrateFromV9ToV10()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 8 && SCHEMA_VERSION === 10) {
            this.migrateFromV8ToV9()
            this.migrateFromV9ToV10()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 7 && SCHEMA_VERSION === 10) {
            this.migrateFromV7ToV8()
            this.migrateFromV8ToV9()
            this.migrateFromV9ToV10()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 6 && SCHEMA_VERSION === 10) {
            this.migrateFromV6ToV7()
            this.migrateFromV7ToV8()
            this.migrateFromV8ToV9()
            this.migrateFromV9ToV10()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 4 && SCHEMA_VERSION === 6) {
            this.migrateFromV4ToV5()
            this.migrateFromV5ToV6()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 4 && SCHEMA_VERSION === 7) {
            this.migrateFromV4ToV5()
            this.migrateFromV5ToV6()
            this.migrateFromV6ToV7()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 5 && SCHEMA_VERSION === 7) {
            this.migrateFromV5ToV6()
            this.migrateFromV6ToV7()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 4 && SCHEMA_VERSION === 9) {
            this.migrateFromV4ToV5()
            this.migrateFromV5ToV6()
            this.migrateFromV6ToV7()
            this.migrateFromV7ToV8()
            this.migrateFromV8ToV9()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 5 && SCHEMA_VERSION === 9) {
            this.migrateFromV5ToV6()
            this.migrateFromV6ToV7()
            this.migrateFromV7ToV8()
            this.migrateFromV8ToV9()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 6 && SCHEMA_VERSION === 9) {
            this.migrateFromV6ToV7()
            this.migrateFromV7ToV8()
            this.migrateFromV8ToV9()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion !== SCHEMA_VERSION) {
            throw this.buildSchemaMismatchError(currentVersion)
        }

        this.assertRequiredTablesPresent()
    }

    private createSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                tag TEXT,
                namespace TEXT NOT NULL DEFAULT 'default',
                machine_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                metadata TEXT,
                metadata_version INTEGER DEFAULT 1,
                agent_state TEXT,
                agent_state_version INTEGER DEFAULT 1,
                model TEXT,
                model_reasoning_effort TEXT,
                effort TEXT,
                todos TEXT,
                todos_updated_at INTEGER,
                team_state TEXT,
                team_state_updated_at INTEGER,
                active INTEGER DEFAULT 0,
                active_at INTEGER,
                seq INTEGER DEFAULT 0,
                channel_id TEXT REFERENCES channels(id) ON DELETE RESTRICT,
                thread_title TEXT,
                thread_status TEXT DEFAULT 'active',
                created_by_user_id TEXT,
                is_channel_bot INTEGER NOT NULL DEFAULT 0,
                scheduled INTEGER NOT NULL DEFAULT 0,
                schedule TEXT,
                pinned INTEGER NOT NULL DEFAULT 0,
                visibility TEXT NOT NULL DEFAULT 'private'
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_tag ON sessions(tag);
            CREATE INDEX IF NOT EXISTS idx_sessions_tag_namespace ON sessions(tag, namespace);
            CREATE INDEX IF NOT EXISTS idx_sessions_channel ON sessions(namespace, channel_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_channel_bot ON sessions(channel_id, is_channel_bot) WHERE is_channel_bot = 1;

            CREATE TABLE IF NOT EXISTS machines (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                metadata TEXT,
                metadata_version INTEGER DEFAULT 1,
                runner_state TEXT,
                runner_state_version INTEGER DEFAULT 1,
                active INTEGER DEFAULT 0,
                active_at INTEGER,
                seq INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_machines_namespace ON machines(namespace);

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                seq INTEGER NOT NULL,
                local_id TEXT,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_local_id ON messages(session_id, local_id) WHERE local_id IS NOT NULL;

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL,
                platform_user_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                created_at INTEGER NOT NULL,
                UNIQUE(platform, platform_user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_users_platform ON users(platform);
            CREATE INDEX IF NOT EXISTS idx_users_platform_namespace ON users(platform, namespace);

            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                namespace TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE(namespace, endpoint)
            );
            CREATE INDEX IF NOT EXISTS idx_push_subscriptions_namespace ON push_subscriptions(namespace);

            CREATE TABLE IF NOT EXISTS channels (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                agent_config TEXT,
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                next_seq INTEGER NOT NULL DEFAULT 1,
                bot_session_id TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_channels_namespace ON channels(namespace);

            CREATE TABLE IF NOT EXISTS channel_members (
                channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'member',
                joined_at INTEGER NOT NULL,
                PRIMARY KEY (channel_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_channel_members_user ON channel_members(user_id);

            CREATE TABLE IF NOT EXISTS workspace_users (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                user_id TEXT NOT NULL,
                display_name TEXT NOT NULL,
                avatar_url TEXT,
                personal_channel_id TEXT REFERENCES channels(id),
                created_at INTEGER NOT NULL,
                last_active_at INTEGER NOT NULL,
                UNIQUE(namespace, user_id)
            );

            CREATE TABLE IF NOT EXISTS channel_messages (
                id TEXT PRIMARY KEY,
                channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                namespace TEXT NOT NULL,
                author_user_id TEXT,
                kind TEXT NOT NULL DEFAULT 'text',
                body TEXT NOT NULL,
                thread_session_id TEXT,
                created_at INTEGER NOT NULL,
                seq INTEGER NOT NULL,
                UNIQUE(channel_id, seq)
            );
            CREATE INDEX IF NOT EXISTS idx_channel_messages_channel ON channel_messages(channel_id, seq);

            CREATE TABLE IF NOT EXISTS channel_message_reactions (
                message_id TEXT NOT NULL REFERENCES channel_messages(id) ON DELETE CASCADE,
                reactor_ref TEXT NOT NULL,
                emoji TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (message_id, reactor_ref, emoji)
            );
            CREATE INDEX IF NOT EXISTS idx_channel_reactions_message ON channel_message_reactions(message_id);

            CREATE TABLE IF NOT EXISTS channel_invites (
                id TEXT PRIMARY KEY,
                channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                namespace TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_channel_invites_channel ON channel_invites(channel_id);
        `)
    }

    private migrateLegacySchemaIfNeeded(): void {
        const columns = this.getMachineColumnNames()
        if (columns.size === 0) {
            return
        }

        const hasDaemon = columns.has('daemon_state') || columns.has('daemon_state_version')
        const hasRunner = columns.has('runner_state') || columns.has('runner_state_version')

        if (hasDaemon && hasRunner) {
            throw new Error('SQLite schema has both daemon_state and runner_state columns in machines; manual cleanup required.')
        }

        if (hasDaemon && !hasRunner) {
            this.migrateFromV1ToV2()
        }
    }

    private migrateFromV1ToV2(): void {
        const columns = this.getMachineColumnNames()
        if (columns.size === 0) {
            throw new Error('SQLite schema missing machines table for v1 to v2 migration.')
        }

        const hasDaemon = columns.has('daemon_state') && columns.has('daemon_state_version')
        const hasRunner = columns.has('runner_state') && columns.has('runner_state_version')

        if (hasRunner && !hasDaemon) {
            return
        }

        if (!hasDaemon) {
            throw new Error('SQLite schema missing daemon_state columns for v1 to v2 migration.')
        }

        try {
            this.db.exec('BEGIN')
            this.db.exec('ALTER TABLE machines RENAME COLUMN daemon_state TO runner_state')
            this.db.exec('ALTER TABLE machines RENAME COLUMN daemon_state_version TO runner_state_version')
            this.db.exec('COMMIT')
            return
        } catch (error) {
            this.db.exec('ROLLBACK')
        }

        try {
            this.db.exec('BEGIN')
            this.db.exec(`
                CREATE TABLE machines_new (
                    id TEXT PRIMARY KEY,
                    namespace TEXT NOT NULL DEFAULT 'default',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    metadata TEXT,
                    metadata_version INTEGER DEFAULT 1,
                    runner_state TEXT,
                    runner_state_version INTEGER DEFAULT 1,
                    active INTEGER DEFAULT 0,
                    active_at INTEGER,
                    seq INTEGER DEFAULT 0
                );
            `)
            this.db.exec(`
                INSERT INTO machines_new (
                    id, namespace, created_at, updated_at,
                    metadata, metadata_version,
                    runner_state, runner_state_version,
                    active, active_at, seq
                )
                SELECT id, namespace, created_at, updated_at,
                       metadata, metadata_version,
                       daemon_state, daemon_state_version,
                       active, active_at, seq
                FROM machines;
            `)
            this.db.exec('DROP TABLE machines')
            this.db.exec('ALTER TABLE machines_new RENAME TO machines')
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_machines_namespace ON machines(namespace)')
            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK')
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`SQLite schema migration v1->v2 failed: ${message}`)
        }
    }

    private migrateFromV2ToV3(): void {
        return
    }

    private migrateFromV3ToV4(): void {
        const columns = this.getSessionColumnNames()
        if (!columns.has('team_state')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN team_state TEXT')
        }
        if (!columns.has('team_state_updated_at')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN team_state_updated_at INTEGER')
        }
    }

    private migrateFromV4ToV5(): void {
        const columns = this.getSessionColumnNames()
        if (!columns.has('model')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN model TEXT')
        }
    }

    private migrateFromV5ToV6(): void {
        const columns = this.getSessionColumnNames()
        if (!columns.has('effort')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN effort TEXT')
        }
    }

    private migrateFromV6ToV7(): void {
        const columns = this.getSessionColumnNames()
        if (!columns.has('model_reasoning_effort')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN model_reasoning_effort TEXT')
        }
    }

    private migrateFromV7ToV8(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS channels (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                agent_config TEXT,
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                next_seq INTEGER NOT NULL DEFAULT 1
            );
            CREATE INDEX IF NOT EXISTS idx_channels_namespace ON channels(namespace);

            CREATE TABLE IF NOT EXISTS channel_members (
                channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'member',
                joined_at INTEGER NOT NULL,
                PRIMARY KEY (channel_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_channel_members_user ON channel_members(user_id);

            CREATE TABLE IF NOT EXISTS workspace_users (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                user_id TEXT NOT NULL,
                display_name TEXT NOT NULL,
                avatar_url TEXT,
                personal_channel_id TEXT REFERENCES channels(id),
                created_at INTEGER NOT NULL,
                last_active_at INTEGER NOT NULL,
                UNIQUE(namespace, user_id)
            );

            CREATE TABLE IF NOT EXISTS channel_messages (
                id TEXT PRIMARY KEY,
                channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                namespace TEXT NOT NULL,
                author_user_id TEXT,
                kind TEXT NOT NULL DEFAULT 'text',
                body TEXT NOT NULL,
                thread_session_id TEXT,
                created_at INTEGER NOT NULL,
                seq INTEGER NOT NULL,
                UNIQUE(channel_id, seq)
            );
            CREATE INDEX IF NOT EXISTS idx_channel_messages_channel ON channel_messages(channel_id, seq);
        `)

        const sessionColumns = this.getSessionColumnNames()
        if (!sessionColumns.has('channel_id')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN channel_id TEXT')
        }
        if (!sessionColumns.has('thread_title')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN thread_title TEXT')
        }
        if (!sessionColumns.has('thread_status')) {
            this.db.exec("ALTER TABLE sessions ADD COLUMN thread_status TEXT DEFAULT 'active'")
        }
        if (!sessionColumns.has('created_by_user_id')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN created_by_user_id TEXT')
        }
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_channel ON sessions(namespace, channel_id)')
    }

    private migrateFromV8ToV9(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS channel_invites (
                id TEXT PRIMARY KEY,
                channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                namespace TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_channel_invites_channel ON channel_invites(channel_id);
        `)

        // Data migration: auto-create workspace defaults for existing sessions
        // This handles existing CLIs that created sessions before the channel system existed
        const namespaces = this.db.prepare(
            'SELECT DISTINCT namespace FROM sessions WHERE channel_id IS NULL'
        ).all() as Array<{ namespace: string }>
        for (const { namespace } of namespaces) {
            try {
                const wuStore = new WorkspaceUserStore(this.db)
                wuStore.ensureDefaults(namespace, namespace, namespace)
                const personalChannelId = wuStore.getPersonalChannelId(namespace, namespace)
                if (personalChannelId) {
                    this.db.prepare(
                        'UPDATE sessions SET channel_id = ? WHERE namespace = ? AND channel_id IS NULL'
                    ).run(personalChannelId, namespace)
                }
            } catch {
                // best-effort: some namespaces may fail if channels already exist
            }
        }
    }

    private migrateFromV9ToV10(): void {
        const sessionColumns = this.getSessionColumnNames()
        if (!sessionColumns.has('is_channel_bot')) {
            this.db.exec("ALTER TABLE sessions ADD COLUMN is_channel_bot INTEGER NOT NULL DEFAULT 0")
        }
        if (!sessionColumns.has('scheduled')) {
            this.db.exec("ALTER TABLE sessions ADD COLUMN scheduled INTEGER NOT NULL DEFAULT 0")
        }
        if (!sessionColumns.has('schedule')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN schedule TEXT')
        }
        if (!sessionColumns.has('pinned')) {
            this.db.exec("ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0")
        }
        if (!sessionColumns.has('visibility')) {
            this.db.exec("ALTER TABLE sessions ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'")
        }
        this.db.exec(
            "CREATE INDEX IF NOT EXISTS idx_sessions_channel_bot ON sessions(channel_id, is_channel_bot) WHERE is_channel_bot = 1"
        )

        const channelColumns = this.getChannelColumnNames()
        if (!channelColumns.has('bot_session_id')) {
            this.db.exec('ALTER TABLE channels ADD COLUMN bot_session_id TEXT')
        }

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS channel_message_reactions (
                message_id TEXT NOT NULL REFERENCES channel_messages(id) ON DELETE CASCADE,
                reactor_ref TEXT NOT NULL,
                emoji TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (message_id, reactor_ref, emoji)
            );
            CREATE INDEX IF NOT EXISTS idx_channel_reactions_message ON channel_message_reactions(message_id);
        `)
    }

    private getSessionColumnNames(): Set<string> {
        const rows = this.db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
    }

    private getMachineColumnNames(): Set<string> {
        const rows = this.db.prepare('PRAGMA table_info(machines)').all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
    }

    private getChannelColumnNames(): Set<string> {
        const rows = this.db.prepare('PRAGMA table_info(channels)').all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
    }

    private getUserVersion(): number {
        const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
        return row?.user_version ?? 0
    }

    private setUserVersion(version: number): void {
        this.db.exec(`PRAGMA user_version = ${version}`)
    }

    private hasAnyUserTables(): boolean {
        const row = this.db.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1"
        ).get() as { name?: string } | undefined
        return Boolean(row?.name)
    }

    private assertRequiredTablesPresent(): void {
        const placeholders = REQUIRED_TABLES.map(() => '?').join(', ')
        const rows = this.db.prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`
        ).all(...REQUIRED_TABLES) as Array<{ name: string }>
        const existing = new Set(rows.map((row) => row.name))
        const missing = REQUIRED_TABLES.filter((table) => !existing.has(table))

        if (missing.length > 0) {
            throw new Error(
                `SQLite schema is missing required tables (${missing.join(', ')}). ` +
                'Back up and rebuild the database, or run an offline migration to the expected schema version.'
            )
        }
    }

    private buildSchemaMismatchError(currentVersion: number): Error {
        const location = (this.dbPath === ':memory:' || this.dbPath.startsWith('file::memory:'))
            ? 'in-memory database'
            : this.dbPath
        return new Error(
            `SQLite schema version mismatch for ${location}. ` +
            `Expected ${SCHEMA_VERSION}, found ${currentVersion}. ` +
            'This build does not run compatibility migrations. ' +
            'Back up and rebuild the database, or run an offline migration to the expected schema version.'
        )
    }
}
