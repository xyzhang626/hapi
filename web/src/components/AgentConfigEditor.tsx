import { useCallback, useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { ApiClient } from '@/api/client'

/**
 * AgentConfig schema (mirrors docs/mvp-ux-stage-2.md §X).
 *
 * Stored at hub-side as ~/.hapi/channels/{channelId}/agent.json. Hub
 * watches the file and injects __config_updated into the bot session
 * on change, so the editor's "Save" is effectively a hot-reload trigger.
 */
type AgentConfig = {
    flavor?: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode'
    model?: string | null
    botName?: string
    systemPromptAddition?: string
    permissionMode?: 'yolo' | 'ask'
    debounceMs?: number
    welcomeStyle?: 'auto' | 'skip' | string
    runnerId?: string | null
}

const FLAVORS: AgentConfig['flavor'][] = ['claude', 'codex', 'cursor', 'gemini', 'opencode']
const PERMISSION_MODES: AgentConfig['permissionMode'][] = ['yolo', 'ask']

type AgentConfigEditorProps = {
    api: ApiClient
    channelId: string
    initialConfig: AgentConfig | null
    onClose: () => void
    onSaved: (config: AgentConfig) => void
    canEdit: boolean
    /** Called after the user confirms a soft or hard delete. Lets the parent navigate away. */
    onDeleted?: () => void
    /** Stage 2: current channel meta — name + description, used by the Channel section. */
    channelName?: string
    channelDescription?: string | null
    /** Current user — needed to mark "you" in the member list and avoid self-remove. */
    currentUserId?: string | null
}

/**
 * Schema-driven AgentConfig form. Owner-only edit (canEdit=true);
 * non-owners see a read-only view of the same fields. Saves are
 * delivered as one PUT /channels/:id with the updated agentConfig
 * blob, which the hub mirrors to the on-disk JSON and hot-reloads.
 */
export function AgentConfigEditor(props: AgentConfigEditorProps) {
    const { api, channelId, initialConfig, onClose, onSaved, canEdit, onDeleted, channelName, channelDescription, currentUserId } = props
    const [draft, setDraft] = useState<AgentConfig>(() => normalize(initialConfig))
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // Members / invite flow
    const [invite, setInvite] = useState<{ id: string; expiresAt: number } | null>(null)
    const [creatingInvite, setCreatingInvite] = useState(false)
    const [inviteError, setInviteError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    // Channel-meta (name / description) edits — owner-only
    const [nameDraft, setNameDraft] = useState(channelName ?? '')
    const [descDraft, setDescDraft] = useState(channelDescription ?? '')
    const [savingMeta, setSavingMeta] = useState(false)
    const [metaError, setMetaError] = useState<string | null>(null)
    // Members list + remove
    const [members, setMembers] = useState<Array<{ userId: string; role: string; displayName?: string; namespace?: string | null }>>([])
    const [loadingMembers, setLoadingMembers] = useState(false)
    const [memberError, setMemberError] = useState<string | null>(null)
    // Danger zone
    const [hardDelete, setHardDelete] = useState(false)
    const [confirmingDelete, setConfirmingDelete] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [deleteError, setDeleteError] = useState<string | null>(null)

    useEffect(() => {
        setDraft(normalize(initialConfig))
        setError(null)
    }, [initialConfig])

    useEffect(() => {
        setNameDraft(channelName ?? '')
        setDescDraft(channelDescription ?? '')
    }, [channelName, channelDescription])

    // Load members on first render so the Members section can list them
    // and (for owner) offer per-row Remove buttons. Re-fetched after each
    // successful remove.
    const loadMembers = useCallback(async () => {
        setLoadingMembers(true)
        setMemberError(null)
        try {
            const r = await api.getChannelMembers(channelId)
            setMembers(r.members as Array<{ userId: string; role: string; displayName?: string; namespace?: string | null }>)
        } catch (err) {
            setMemberError(err instanceof Error ? err.message : 'Failed to load members')
        } finally {
            setLoadingMembers(false)
        }
    }, [api, channelId])

    useEffect(() => {
        void loadMembers()
    }, [loadMembers])

    // When the channel had no agentConfig at all, the very first save initializes
    // it — treat the form as dirty so the user can press Save without
    // having to mutate a field. Otherwise compare against the normalized
    // initial state.
    const dirty = useMemo(() => {
        if (initialConfig == null) return true
        return JSON.stringify(draft) !== JSON.stringify(normalize(initialConfig))
    }, [draft, initialConfig])

    const handleSave = async () => {
        if (!canEdit) return
        setSaving(true)
        setError(null)
        try {
            await api.updateChannelAgentConfig(channelId, draft)
            onSaved(draft)
            onClose()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save agent config')
        } finally {
            setSaving(false)
        }
    }

    const update = <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) => {
        setDraft((prev) => ({ ...prev, [key]: value }))
    }

    const inviteUrl = useMemo(() => {
        if (!invite) return ''
        return `${window.location.origin}/invite/${invite.id}`
    }, [invite])

    const handleGenerateInvite = async () => {
        setCreatingInvite(true)
        setInviteError(null)
        setCopied(false)
        try {
            const r = await api.createChannelInvite(channelId)
            setInvite(r.invite)
        } catch (err) {
            setInviteError(err instanceof Error ? err.message : 'Failed to generate invite')
        } finally {
            setCreatingInvite(false)
        }
    }

    const handleCopyInvite = async () => {
        if (!inviteUrl) return
        try {
            await navigator.clipboard.writeText(inviteUrl)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch {
            setInviteError('Clipboard write failed — copy the link manually')
        }
    }

    const handleConfirmDelete = async () => {
        setDeleting(true)
        setDeleteError(null)
        try {
            await api.deleteChannel(channelId, { hard: hardDelete })
            onDeleted?.()
            onClose()
        } catch (err) {
            setDeleteError(err instanceof Error ? err.message : 'Failed to delete channel')
        } finally {
            setDeleting(false)
        }
    }

    const handleSaveMeta = async () => {
        setSavingMeta(true)
        setMetaError(null)
        try {
            const updates: { name?: string; description?: string | null } = {}
            const trimmedName = nameDraft.trim()
            if (trimmedName && trimmedName !== (channelName ?? '')) {
                updates.name = trimmedName
            }
            const trimmedDesc = descDraft.trim()
            if (trimmedDesc !== (channelDescription ?? '').trim()) {
                updates.description = trimmedDesc || null
            }
            if (Object.keys(updates).length === 0) {
                return
            }
            await api.updateChannel(channelId, updates)
            // Channel-updated SSE will refresh sidebar/header; no explicit reload here.
        } catch (err) {
            setMetaError(err instanceof Error ? err.message : 'Failed to update channel')
        } finally {
            setSavingMeta(false)
        }
    }

    const handleRemoveMember = async (userId: string, displayName: string) => {
        if (!confirm(`Remove ${displayName} from this channel?`)) return
        setMemberError(null)
        try {
            await api.removeChannelMember(channelId, userId)
            await loadMembers()
        } catch (err) {
            setMemberError(err instanceof Error ? err.message : 'Failed to remove member')
        }
    }

    const metaDirty = useMemo(() => {
        const trimmedName = nameDraft.trim()
        const trimmedDesc = descDraft.trim()
        const initialDesc = (channelDescription ?? '').trim()
        return (trimmedName !== '' && trimmedName !== (channelName ?? ''))
            || (trimmedDesc !== initialDesc)
    }, [nameDraft, descDraft, channelName, channelDescription])

    return (
        <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        Channel agent settings
                    </DialogTitle>
                </DialogHeader>

                {!canEdit && (
                    <div className="mt-2 px-3 py-2 rounded-md text-xs"
                        style={{ background: 'var(--app-subtle-bg)', color: 'var(--app-hint)' }}>
                        View only — only the channel owner can edit these settings.
                    </div>
                )}

                <div className="mt-4 space-y-5">
                    <Section title="Channel" hint="Channel name and description (owner can edit)">
                        <Field label="Channel name">
                            <input
                                type="text"
                                value={nameDraft}
                                onChange={(e) => setNameDraft(e.target.value)}
                                disabled={!canEdit || savingMeta}
                                placeholder="channel-name"
                                className="form-input"
                            />
                        </Field>
                        <Field label="Description" hint="Short summary shown in the channel header">
                            <input
                                type="text"
                                value={descDraft}
                                onChange={(e) => setDescDraft(e.target.value)}
                                disabled={!canEdit || savingMeta}
                                placeholder="What this channel is for"
                                className="form-input"
                            />
                        </Field>
                        {canEdit && (
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={handleSaveMeta}
                                    disabled={savingMeta || !metaDirty}
                                >
                                    {savingMeta ? 'Saving…' : 'Save channel meta'}
                                </Button>
                                {metaError && (
                                    <span className="text-xs text-red-500">{metaError}</span>
                                )}
                            </div>
                        )}
                    </Section>

                    <Section title="Identity" hint="Who the bot is in this channel">
                        <Field label="Bot name">
                            <input
                                type="text"
                                value={draft.botName ?? 'Agent'}
                                onChange={(e) => update('botName', e.target.value)}
                                disabled={!canEdit || saving}
                                placeholder="Agent"
                                className="form-input"
                            />
                        </Field>

                        <Field label="Flavor" hint="Which agent runs the bot session">
                            <select
                                value={draft.flavor ?? 'claude'}
                                onChange={(e) => update('flavor', e.target.value as AgentConfig['flavor'])}
                                disabled={!canEdit || saving}
                                className="form-input"
                            >
                                {FLAVORS.map((f) => (
                                    <option key={f} value={f}>{f}</option>
                                ))}
                            </select>
                        </Field>

                        <Field label="Model" hint="Specific model id (leave empty for flavor default)">
                            <input
                                type="text"
                                value={draft.model ?? ''}
                                onChange={(e) => update('model', e.target.value || null)}
                                disabled={!canEdit || saving}
                                placeholder="claude-opus-4-7"
                                className="form-input"
                            />
                        </Field>
                    </Section>

                    <Section title="Behavior" hint="How the bot reacts in conversation">
                        <Field label="System prompt addition" hint="Extra rules appended to the bot's base prompt">
                            <textarea
                                value={draft.systemPromptAddition ?? ''}
                                onChange={(e) => update('systemPromptAddition', e.target.value)}
                                disabled={!canEdit || saving}
                                placeholder="e.g. You are the PM agent for #engineering. Focus on backend code quality."
                                rows={4}
                                className="form-input resize-y"
                            />
                        </Field>

                        <Field label="Welcome style" hint="auto / skip / custom:{text}">
                            <input
                                type="text"
                                value={draft.welcomeStyle ?? 'auto'}
                                onChange={(e) => update('welcomeStyle', e.target.value)}
                                disabled={!canEdit || saving}
                                placeholder="auto"
                                className="form-input"
                            />
                        </Field>

                        <Field label="Weak-signal debounce (ms)" hint="How long to wait before flushing a batch of weak-signal user messages">
                            <input
                                type="number"
                                value={draft.debounceMs ?? 3000}
                                onChange={(e) => {
                                    const n = Number(e.target.value)
                                    update('debounceMs', Number.isFinite(n) ? n : 3000)
                                }}
                                disabled={!canEdit || saving}
                                min={500}
                                max={30000}
                                step={500}
                                className="form-input"
                            />
                        </Field>
                    </Section>

                    <Section title="Permissions" hint="What the spawned threads are allowed to do">
                        <Field label="Permission mode">
                            <select
                                value={draft.permissionMode ?? 'yolo'}
                                onChange={(e) => update('permissionMode', e.target.value as AgentConfig['permissionMode'])}
                                disabled={!canEdit || saving}
                                className="form-input"
                            >
                                {PERMISSION_MODES.map((m) => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                        </Field>
                    </Section>

                    <Section title="Advanced" hint="Routing and infrastructure">
                        <Field label="Runner id" hint="Empty = use hub's embedded runner">
                            <input
                                type="text"
                                value={draft.runnerId ?? ''}
                                onChange={(e) => update('runnerId', e.target.value || null)}
                                disabled={!canEdit || saving}
                                placeholder=""
                                className="form-input"
                            />
                        </Field>
                    </Section>

                    <Section title="Members" hint="Invite anyone with the link to join this channel">
                        <Field label="Invite link" hint="One-shot link, expires in ~7 days. Anyone signed in to a hub can use it to join.">
                            {invite ? (
                                <div className="flex flex-col gap-2">
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            readOnly
                                            value={inviteUrl}
                                            onClick={(e) => (e.target as HTMLInputElement).select()}
                                            className="form-input"
                                        />
                                        <Button type="button" variant="secondary" onClick={handleCopyInvite}>
                                            {copied ? 'Copied!' : 'Copy'}
                                        </Button>
                                    </div>
                                    <div className="text-xs" style={{ color: 'var(--app-hint)' }}>
                                        Expires {new Date(invite.expiresAt).toLocaleString()}
                                    </div>
                                </div>
                            ) : (
                                <Button
                                    type="button"
                                    variant="secondary"
                                    disabled={creatingInvite}
                                    onClick={handleGenerateInvite}
                                >
                                    {creatingInvite ? 'Generating…' : 'Generate invite link'}
                                </Button>
                            )}
                            {inviteError && (
                                <div className="mt-2 text-xs text-red-500">{inviteError}</div>
                            )}
                        </Field>
                        <Field label="Current members" hint="Owner can remove members; leaving the channel removes you">
                            {loadingMembers ? (
                                <div className="text-xs" style={{ color: 'var(--app-hint)' }}>Loading…</div>
                            ) : members.length === 0 ? (
                                <div className="text-xs" style={{ color: 'var(--app-hint)' }}>No members</div>
                            ) : (
                                <div className="flex flex-col gap-1">
                                    {members.map((m) => {
                                        const label = m.displayName ?? m.userId
                                        const isMe = currentUserId != null && m.userId === currentUserId
                                        const isOwner = m.role === 'owner'
                                        const showRemove = canEdit && !isOwner && !isMe
                                        return (
                                            <div key={m.userId} className="flex items-center justify-between gap-2 px-2 py-1 rounded text-sm" style={{ background: 'var(--app-secondary-bg)' }}>
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className="truncate">{label}</span>
                                                    {m.namespace && (
                                                        <span className="text-xs" style={{ color: 'var(--app-hint)' }}>({m.namespace})</span>
                                                    )}
                                                    {isMe && (
                                                        <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--app-subtle-bg)', color: 'var(--app-hint)' }}>you</span>
                                                    )}
                                                    {isOwner && (
                                                        <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--app-subtle-bg)', color: 'var(--app-link)' }}>owner</span>
                                                    )}
                                                </div>
                                                {showRemove && (
                                                    <Button type="button" variant="secondary" onClick={() => handleRemoveMember(m.userId, label)}>
                                                        Remove
                                                    </Button>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                            {memberError && (
                                <div className="mt-2 text-xs text-red-500">{memberError}</div>
                            )}
                        </Field>
                    </Section>

                    {canEdit && (
                        <Section title="Danger zone" hint="Delete this channel">
                            <Field label="Delete channel" hint="Default soft-delete archives the workspace folder. Hard delete removes it from disk.">
                                <div className="flex flex-col gap-2">
                                    <label className="flex items-center gap-2 text-xs">
                                        <input
                                            type="checkbox"
                                            checked={hardDelete}
                                            onChange={(e) => setHardDelete(e.target.checked)}
                                        />
                                        Also delete files (cannot be undone)
                                    </label>
                                    <Button
                                        type="button"
                                        variant="destructive"
                                        onClick={() => setConfirmingDelete(true)}
                                    >
                                        Delete channel
                                    </Button>
                                </div>
                            </Field>
                        </Section>
                    )}
                </div>

                {error && (
                    <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                        {error}
                    </div>
                )}

                <div className="mt-5 flex gap-2 justify-end">
                    <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
                        {canEdit ? 'Cancel' : 'Close'}
                    </Button>
                    {canEdit && (
                        <Button
                            type="button"
                            onClick={handleSave}
                            disabled={saving || !dirty}
                        >
                            {saving ? 'Saving…' : 'Save & hot-reload'}
                        </Button>
                    )}
                </div>

                {confirmingDelete && (
                    <div
                        className="absolute inset-0 flex items-center justify-center"
                        style={{ background: 'color-mix(in srgb, var(--app-bg) 85%, transparent)' }}
                    >
                        <div
                            className="rounded-lg border p-5 max-w-sm w-full"
                            style={{ background: 'var(--app-bg)', borderColor: 'var(--app-border)' }}
                        >
                            <div className="font-semibold mb-2">Delete this channel?</div>
                            <div className="text-sm mb-4" style={{ color: 'var(--app-hint)' }}>
                                {hardDelete
                                    ? 'This will remove the channel from the sidebar and PERMANENTLY delete the workspace folder on disk. This cannot be undone.'
                                    : 'This will hide the channel and rename its workspace folder to *-archived-{ts}. Files are kept on disk.'}
                            </div>
                            {deleteError && (
                                <div className="text-sm mb-3 text-red-500">{deleteError}</div>
                            )}
                            <div className="flex gap-2 justify-end">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => setConfirmingDelete(false)}
                                    disabled={deleting}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="button"
                                    variant="destructive"
                                    onClick={handleConfirmDelete}
                                    disabled={deleting}
                                >
                                    {deleting ? 'Deleting…' : (hardDelete ? 'Delete + remove files' : 'Soft delete')}
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                <style>{`
                    .form-input {
                        width: 100%;
                        padding: 0.5rem 0.75rem;
                        border-radius: 0.375rem;
                        border: 1px solid var(--app-border);
                        background: var(--app-bg);
                        color: var(--app-fg);
                        font-size: 0.875rem;
                    }
                    .form-input:focus {
                        outline: none;
                        border-color: var(--app-link);
                        box-shadow: 0 0 0 2px color-mix(in srgb, var(--app-link) 20%, transparent);
                    }
                    .form-input:disabled {
                        opacity: 0.55;
                        cursor: not-allowed;
                    }
                `}</style>
            </DialogContent>
        </Dialog>
    )
}

function Section(props: { title: string; hint?: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="mb-2">
                <div className="text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--app-fg)' }}>
                    {props.title}
                </div>
                {props.hint && (
                    <div className="text-xs" style={{ color: 'var(--app-hint)' }}>
                        {props.hint}
                    </div>
                )}
            </div>
            <div className="space-y-3">{props.children}</div>
        </div>
    )
}

function Field(props: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <div className="text-xs mb-1" style={{ color: 'var(--app-fg)' }}>
                {props.label}
            </div>
            {props.children}
            {props.hint && (
                <div className="text-[11px] mt-1" style={{ color: 'var(--app-hint)' }}>
                    {props.hint}
                </div>
            )}
        </label>
    )
}

function normalize(c: AgentConfig | null): AgentConfig {
    return {
        flavor: c?.flavor ?? 'claude',
        model: c?.model ?? null,
        botName: c?.botName ?? 'Agent',
        systemPromptAddition: c?.systemPromptAddition ?? '',
        permissionMode: c?.permissionMode ?? 'yolo',
        debounceMs: c?.debounceMs ?? 3000,
        welcomeStyle: c?.welcomeStyle ?? 'auto',
        runnerId: c?.runnerId ?? null,
    }
}
