import { describe, expect, it, vi } from 'vitest';
import { PermissionHandler } from './permissionHandler';
import { PLAN_FAKE_REJECT, PLAN_FAKE_RESTART } from '../sdk/prompts';

type FakeAgentState = {
    requests?: Record<string, unknown>;
    completedRequests?: Record<string, unknown>;
};

function createSessionStub() {
    const rpcHandlers = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
    let agentState: FakeAgentState = {
        requests: {},
        completedRequests: {}
    };

    const session = {
        queue: {
            unshiftIsolate: vi.fn()
        },
        clearSessionId: vi.fn(),
        getModeSnapshot: vi.fn(() => ({
            permissionMode: 'plan',
            model: 'sonnet',
            effort: 'high',
            appendSystemPrompt: 'current append prompt'
        })),
        setPermissionMode: vi.fn(),
        client: {
            rpcHandlerManager: {
                registerHandler(method: string, handler: (params: unknown) => Promise<unknown> | unknown) {
                    rpcHandlers.set(method, handler);
                }
            },
            updateAgentState(handler: (state: FakeAgentState) => FakeAgentState) {
                agentState = handler(agentState);
            }
        }
    };

    return {
        session,
        rpcHandlers,
        getAgentState: () => agentState
    };
}

describe('PermissionHandler exit_plan_mode', () => {
    it('defaults to keep_context and preserves the full mode snapshot when restarting', async () => {
        const { session, rpcHandlers, getAgentState } = createSessionStub();
        const permissionHandler = new PermissionHandler(session as never);

        permissionHandler.onMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{
                    type: 'tool_use',
                    id: 'tool-exit-plan',
                    name: 'exit_plan_mode',
                    input: { plan: 'Implement the approved plan' }
                }]
            }
        } as never);

        const toolCall = permissionHandler.handleToolCall(
            'exit_plan_mode',
            { plan: 'Implement the approved plan' },
            { permissionMode: 'plan' } as never,
            { signal: new AbortController().signal }
        );

        const permissionRpc = rpcHandlers.get('permission');
        expect(permissionRpc).toBeTypeOf('function');

        await permissionRpc?.({
            id: 'tool-exit-plan',
            approved: true
        });

        await expect(toolCall).resolves.toEqual({
            behavior: 'deny',
            message: PLAN_FAKE_REJECT
        });

        expect(session.clearSessionId).not.toHaveBeenCalled();
        expect(session.queue.unshiftIsolate).toHaveBeenCalledWith(PLAN_FAKE_RESTART, {
            permissionMode: 'default',
            model: 'sonnet',
            effort: 'high',
            appendSystemPrompt: 'current append prompt'
        });
        expect(permissionHandler.getResponses().get('tool-exit-plan')).toMatchObject({
            approved: true,
            mode: 'default',
            implementationMode: 'keep_context'
        });

        expect(getAgentState().completedRequests).toMatchObject({
            'tool-exit-plan': {
                status: 'approved',
                implementationMode: 'keep_context'
            }
        });
    });

    it('clears context only when explicitly requested and requeues the approved plan for fresh-context restart', async () => {
        const { session, rpcHandlers } = createSessionStub();
        const permissionHandler = new PermissionHandler(session as never);

        permissionHandler.onMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{
                    type: 'tool_use',
                    id: 'tool-exit-plan-accept',
                    name: 'ExitPlanMode',
                    input: { plan: 'Implement with accept-edits' }
                }]
            }
        } as never);

        const toolCall = permissionHandler.handleToolCall(
            'ExitPlanMode',
            { plan: 'Implement with accept-edits' },
            { permissionMode: 'plan' } as never,
            { signal: new AbortController().signal }
        );

        const permissionRpc = rpcHandlers.get('permission');
        expect(permissionRpc).toBeTypeOf('function');

        await permissionRpc?.({
            id: 'tool-exit-plan-accept',
            approved: true,
            mode: 'acceptEdits',
            implementationMode: 'clear_context'
        });

        await expect(toolCall).resolves.toEqual({
            behavior: 'deny',
            message: PLAN_FAKE_REJECT
        });

        expect(session.clearSessionId).toHaveBeenCalledTimes(1);
        expect(session.queue.unshiftIsolate).toHaveBeenCalledWith(expect.stringContaining('Implement with accept-edits'), {
            permissionMode: 'acceptEdits',
            model: 'sonnet',
            effort: 'high',
            appendSystemPrompt: 'current append prompt'
        });
    });

    it('normalizes invalid post-plan modes to default before updating session state', async () => {
        const { session, rpcHandlers, getAgentState } = createSessionStub();
        const permissionHandler = new PermissionHandler(session as never);

        permissionHandler.onMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{
                    type: 'tool_use',
                    id: 'tool-exit-plan-invalid-mode',
                    name: 'exit_plan_mode',
                    input: { plan: 'Implement safely' }
                }]
            }
        } as never);

        const toolCall = permissionHandler.handleToolCall(
            'exit_plan_mode',
            { plan: 'Implement safely' },
            { permissionMode: 'plan' } as never,
            { signal: new AbortController().signal }
        );

        const permissionRpc = rpcHandlers.get('permission');
        expect(permissionRpc).toBeTypeOf('function');

        await permissionRpc?.({
            id: 'tool-exit-plan-invalid-mode',
            approved: true,
            mode: 'plan'
        });

        await expect(toolCall).resolves.toEqual({
            behavior: 'deny',
            message: PLAN_FAKE_REJECT
        });

        expect(session.setPermissionMode).toHaveBeenLastCalledWith('default');
        expect(session.queue.unshiftIsolate).toHaveBeenCalledWith(PLAN_FAKE_RESTART, {
            permissionMode: 'default',
            model: 'sonnet',
            effort: 'high',
            appendSystemPrompt: 'current append prompt'
        });
        expect(permissionHandler.getResponses().get('tool-exit-plan-invalid-mode')).toMatchObject({
            approved: true,
            mode: 'default',
            implementationMode: 'keep_context'
        });
        expect(getAgentState().completedRequests).toMatchObject({
            'tool-exit-plan-invalid-mode': {
                status: 'approved',
                mode: 'default',
                implementationMode: 'keep_context'
            }
        });
    });
});

describe('PermissionHandler metadata normalization', () => {
    it('does not apply allowTools or mode side effects when question answers are missing', async () => {
        const { session, rpcHandlers, getAgentState } = createSessionStub();
        const permissionHandler = new PermissionHandler(session as never);

        permissionHandler.onMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{
                    type: 'tool_use',
                    id: 'tool-question-empty',
                    name: 'ask_user_question',
                    input: {
                        questions: [{ question: 'Proceed?' }]
                    }
                }]
            }
        } as never);

        const questionCall = permissionHandler.handleToolCall(
            'ask_user_question',
            { questions: [{ question: 'Proceed?' }] },
            { permissionMode: 'default' } as never,
            { signal: new AbortController().signal }
        );

        const permissionRpc = rpcHandlers.get('permission');
        expect(permissionRpc).toBeTypeOf('function');

        await permissionRpc?.({
            id: 'tool-question-empty',
            approved: true,
            mode: 'acceptEdits',
            allowTools: ['Edit'],
            answers: {}
        });

        await expect(questionCall).resolves.toEqual({
            behavior: 'deny',
            message: 'No answers were provided.'
        });

        expect(session.setPermissionMode).not.toHaveBeenCalled();
        expect(permissionHandler.getResponses().get('tool-question-empty')).toMatchObject({
            approved: false,
            reason: 'No answers were provided.'
        });
        expect(permissionHandler.getResponses().get('tool-question-empty')?.mode).toBeUndefined();
        expect(permissionHandler.getResponses().get('tool-question-empty')?.allowTools).toBeUndefined();
        expect(getAgentState().completedRequests).toMatchObject({
            'tool-question-empty': {
                status: 'denied',
                reason: 'No answers were provided.'
            }
        });

        permissionHandler.onMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{
                    type: 'tool_use',
                    id: 'tool-edit-after-empty-answer',
                    name: 'Edit',
                    input: {
                        file_path: 'src/example.ts',
                        old_string: 'before',
                        new_string: 'after'
                    }
                }]
            }
        } as never);

        const abortController = new AbortController();
        const editCall = permissionHandler.handleToolCall(
            'Edit',
            {
                file_path: 'src/example.ts',
                old_string: 'before',
                new_string: 'after'
            },
            { permissionMode: 'default' } as never,
            { signal: abortController.signal }
        );

        expect(getAgentState().requests).toMatchObject({
            'tool-edit-after-empty-answer': {
                tool: 'Edit'
            }
        });

        abortController.abort();
        await expect(editCall).rejects.toThrow('Permission request aborted');
    });

    it('preserves permission decisions in responses and completed requests', async () => {
        const { session, rpcHandlers, getAgentState } = createSessionStub();
        const permissionHandler = new PermissionHandler(session as never);

        permissionHandler.onMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{
                    type: 'tool_use',
                    id: 'tool-edit-decision',
                    name: 'Edit',
                    input: {
                        file_path: 'src/example.ts',
                        old_string: 'before',
                        new_string: 'after'
                    }
                }]
            }
        } as never);

        const toolCall = permissionHandler.handleToolCall(
            'Edit',
            {
                file_path: 'src/example.ts',
                old_string: 'before',
                new_string: 'after'
            },
            { permissionMode: 'default' } as never,
            { signal: new AbortController().signal }
        );

        const permissionRpc = rpcHandlers.get('permission');
        expect(permissionRpc).toBeTypeOf('function');

        await permissionRpc?.({
            id: 'tool-edit-decision',
            approved: true,
            decision: 'approved_for_session'
        });

        await expect(toolCall).resolves.toEqual({
            behavior: 'allow',
            updatedInput: {
                file_path: 'src/example.ts',
                old_string: 'before',
                new_string: 'after'
            }
        });

        expect(permissionHandler.getResponses().get('tool-edit-decision')).toMatchObject({
            approved: true,
            decision: 'approved_for_session'
        });
        expect(getAgentState().completedRequests).toMatchObject({
            'tool-edit-decision': {
                status: 'approved',
                decision: 'approved_for_session'
            }
        });
    });
});
