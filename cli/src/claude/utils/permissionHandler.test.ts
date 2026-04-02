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
