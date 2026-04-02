import { describe, expect, it } from 'vitest'
import { reduceTimeline } from './reducerTimeline'
import type { ToolCallBlock } from './types'
import type { TracedMessage } from './tracer'

function makeContext() {
    return {
        permissionsById: new Map(),
        groups: new Map(),
        consumedGroupIds: new Set<string>(),
        titleChangesByToolUseId: new Map(),
        emittedTitleChangeToolUseIds: new Set<string>()
    }
}

function makeUserMessage(text: string, overrides?: Partial<TracedMessage>): TracedMessage {
    return {
        id: 'msg-1',
        localId: null,
        createdAt: 1_700_000_000_000,
        role: 'user',
        content: { type: 'text', text },
        isSidechain: false,
        ...overrides
    } as TracedMessage
}

describe('reduceTimeline', () => {
    it('renders user text as user-text block', () => {
        const text = 'Hello, this is a normal message'
        const { blocks } = reduceTimeline([makeUserMessage(text)], makeContext())

        expect(blocks).toHaveLength(1)
        expect(blocks[0].kind).toBe('user-text')
    })

    it('does not filter XML-like user text (filtering is in normalize layer)', () => {
        const text = '<task-notification> <summary>Some task</summary> </task-notification>'
        const { blocks } = reduceTimeline([makeUserMessage(text)], makeContext())

        expect(blocks).toHaveLength(1)
        expect(blocks[0].kind).toBe('user-text')
    })

    it('preserves permission mode and implementationMode from agent state when tool-result permissions omit them', () => {
        const messages: TracedMessage[] = [{
            id: 'message-1',
            localId: null,
            createdAt: 2,
            role: 'agent',
            isSidechain: false,
            content: [{
                type: 'tool-result',
                tool_use_id: 'tool-1',
                content: { ok: true },
                is_error: false,
                uuid: 'uuid-1',
                parentUUID: null,
                permissions: {
                    date: 2,
                    result: 'approved'
                }
            }]
        }]

        const result = reduceTimeline(messages, {
            permissionsById: new Map([
                ['tool-1', {
                    toolName: 'exit_plan_mode',
                    input: { plan: 'Ship it' },
                    permission: {
                        id: 'tool-1',
                        status: 'approved',
                        mode: 'acceptEdits',
                        implementationMode: 'clear_context'
                    }
                }]
            ]),
            groups: new Map(),
            consumedGroupIds: new Set(),
            titleChangesByToolUseId: new Map(),
            emittedTitleChangeToolUseIds: new Set()
        })

        const block = result.blocks[0] as ToolCallBlock
        expect(block.kind).toBe('tool-call')
        expect(block.tool.permission).toMatchObject({
            id: 'tool-1',
            status: 'approved',
            mode: 'acceptEdits',
            implementationMode: 'clear_context'
        })
    })
})
