import type { Database } from 'bun:sqlite'

import type { StoredSession, VersionedUpdateResult } from './types'
import {
    attachToChannel,
    deleteSession,
    detachSession,
    detachSessionsFromChannel,
    getOrCreateSession,
    getSession,
    getSessionByNamespace,
    getSessions,
    getSessionsByChannel,
    getSessionsByNamespace,
    getUnassignedSessions,
    setSessionEffort,
    setSessionModel,
    setSessionModelReasoningEffort,
    setSessionTeamState,
    setSessionTodos,
    setThreadStatus,
    touchSessionUpdatedAt,
    updateSessionAgentState,
    updateSessionMetadata
} from './sessions'

export class SessionStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    getOrCreateSession(
        tag: string,
        metadata: unknown,
        agentState: unknown,
        namespace: string,
        model?: string,
        effort?: string,
        modelReasoningEffort?: string,
        channelOpts?: { channelId?: string; threadTitle?: string; createdByUserId?: string }
    ): StoredSession {
        return getOrCreateSession(this.db, tag, metadata, agentState, namespace, model, effort, modelReasoningEffort, channelOpts)
    }

    updateSessionMetadata(
        id: string,
        metadata: unknown,
        expectedVersion: number,
        namespace: string,
        options?: { touchUpdatedAt?: boolean }
    ): VersionedUpdateResult<unknown | null> {
        return updateSessionMetadata(this.db, id, metadata, expectedVersion, namespace, options)
    }

    updateSessionAgentState(
        id: string,
        agentState: unknown,
        expectedVersion: number,
        namespace: string
    ): VersionedUpdateResult<unknown | null> {
        return updateSessionAgentState(this.db, id, agentState, expectedVersion, namespace)
    }

    setSessionTodos(id: string, todos: unknown, todosUpdatedAt: number, namespace: string): boolean {
        return setSessionTodos(this.db, id, todos, todosUpdatedAt, namespace)
    }

    setSessionTeamState(id: string, teamState: unknown, updatedAt: number, namespace: string): boolean {
        return setSessionTeamState(this.db, id, teamState, updatedAt, namespace)
    }

    setSessionModel(id: string, model: string | null, namespace: string, options?: { touchUpdatedAt?: boolean }): boolean {
        return setSessionModel(this.db, id, model, namespace, options)
    }

    setSessionModelReasoningEffort(
        id: string,
        modelReasoningEffort: string | null,
        namespace: string,
        options?: { touchUpdatedAt?: boolean }
    ): boolean {
        return setSessionModelReasoningEffort(this.db, id, modelReasoningEffort, namespace, options)
    }

    setSessionEffort(id: string, effort: string | null, namespace: string, options?: { touchUpdatedAt?: boolean }): boolean {
        return setSessionEffort(this.db, id, effort, namespace, options)
    }

    touchSessionUpdatedAt(id: string, updatedAt: number, namespace: string): boolean {
        return touchSessionUpdatedAt(this.db, id, updatedAt, namespace)
    }

    getSession(id: string): StoredSession | null {
        return getSession(this.db, id)
    }

    getSessionByNamespace(id: string, namespace: string): StoredSession | null {
        return getSessionByNamespace(this.db, id, namespace)
    }

    getSessions(): StoredSession[] {
        return getSessions(this.db)
    }

    getSessionsByNamespace(namespace: string, opts?: { channelId?: string }): StoredSession[] {
        return getSessionsByNamespace(this.db, namespace, opts)
    }

    deleteSession(id: string, namespace: string): boolean {
        return deleteSession(this.db, id, namespace)
    }

    getSessionsByChannel(channelId: string, namespace: string): StoredSession[] {
        return getSessionsByChannel(this.db, channelId, namespace)
    }

    getUnassignedSessions(namespace: string): StoredSession[] {
        return getUnassignedSessions(this.db, namespace)
    }

    detachSessionsFromChannel(channelId: string, namespace: string): number {
        return detachSessionsFromChannel(this.db, channelId, namespace)
    }

    detachSession(sessionId: string, channelId: string, namespace: string): boolean {
        return detachSession(this.db, sessionId, channelId, namespace)
    }

    setThreadStatus(sessionId: string, namespace: string, status: 'active' | 'completed' | 'archived'): boolean {
        return setThreadStatus(this.db, sessionId, namespace, status)
    }

    attachToChannel(sessionId: string, namespace: string, channelId: string, threadTitle: string, createdByUserId: string): boolean {
        return attachToChannel(this.db, sessionId, namespace, channelId, threadTitle, createdByUserId)
    }
}
