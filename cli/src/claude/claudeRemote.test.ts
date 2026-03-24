import { describe, it, expect, vi } from 'vitest';
import type { SDKMessage } from '@/claude/sdk/types';

vi.mock('@/claude/utils/claudeCheckSession', () => ({
    claudeCheckSession: () => true
}));

vi.mock('@/modules/watcher/awaitFileExist', () => ({
    awaitFileExist: async () => true
}));

const queryMock = vi.fn();

vi.mock('@/claude/sdk', () => {
    class AbortError extends Error {}
    return {
        query: queryMock,
        AbortError
    };
});

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
} {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function createAsyncStream(messages: SDKMessage[]): AsyncIterable<SDKMessage> {
    return {
        async *[Symbol.asyncIterator]() {
            for (const message of messages) {
                await Promise.resolve();
                yield message;
            }
        }
    };
}

async function waitFor(condition: () => boolean, timeoutMs = 300, intervalMs = 10): Promise<void> {
    const startedAt = Date.now();
    while (!condition()) {
        if (Date.now() - startedAt > timeoutMs) {
            throw new Error('Timed out waiting for condition');
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}

describe('claudeRemote async message handling', () => {
    it('continues consuming assistant messages even when next user message is pending', async () => {
        const { claudeRemote } = await import('./claudeRemote');
        const pendingNext = deferred<{ message: string; mode: { permissionMode: 'default' } } | null>();
        const received: SDKMessage[] = [];

        const sdkMessages: SDKMessage[] = [
            {
                type: 'assistant',
                message: {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'A_1' }]
                }
            } as unknown as SDKMessage,
            {
                type: 'result',
                subtype: 'success',
                num_turns: 1,
                total_cost_usd: 0,
                duration_ms: 1,
                duration_api_ms: 1,
                is_error: false,
                session_id: 's-1'
            } as unknown as SDKMessage,
            {
                type: 'assistant',
                message: {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'A_2' }]
                }
            } as unknown as SDKMessage
        ];

        queryMock.mockReturnValueOnce(createAsyncStream(sdkMessages));

        let nextCallCount = 0;
        const runPromise = claudeRemote({
            sessionId: 'session-1',
            path: process.cwd(),
            mcpServers: {},
            claudeEnvVars: {},
            claudeArgs: [],
            allowedTools: [],
            hookSettingsPath: '/tmp/hook.json',
            canCallTool: async () => ({ behavior: 'allow', updatedInput: {} }),
            nextMessage: async () => {
                nextCallCount += 1;
                if (nextCallCount === 1) {
                    return { message: 'A', mode: { permissionMode: 'default' } };
                }
                return await pendingNext.promise;
            },
            onReady: () => {},
            isAborted: () => false,
            onSessionFound: () => {},
            onMessage: (message) => {
                received.push(message);
            },
            onCompletionEvent: () => {},
            onSessionReset: () => {}
        });

        await waitFor(() => received.length >= 3);
        expect(received.map((m) => m.type)).toEqual(['assistant', 'result', 'assistant']);

        pendingNext.resolve(null);
        await runPromise;
    });
});
