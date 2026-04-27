import { useEffect, useMemo, useState } from 'react'
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
}

/**
 * Schema-driven AgentConfig form. Owner-only edit (canEdit=true);
 * non-owners see a read-only view of the same fields. Saves are
 * delivered as one PUT /channels/:id with the updated agentConfig
 * blob, which the hub mirrors to the on-disk JSON and hot-reloads.
 */
export function AgentConfigEditor(props: AgentConfigEditorProps) {
    const { api, channelId, initialConfig, onClose, onSaved, canEdit } = props
    const [draft, setDraft] = useState<AgentConfig>(() => normalize(initialConfig))
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        setDraft(normalize(initialConfig))
        setError(null)
    }, [initialConfig])

    const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(normalize(initialConfig)), [draft, initialConfig])

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
                                onChange={(e) => update('debounceMs', Number(e.target.value) || 3000)}
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
