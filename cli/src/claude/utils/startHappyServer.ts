/**
 * HAPI MCP server
 * Provides HAPI CLI specific tools.
 *
 * Tool sets registered depend on session metadata:
 *   - Always: change_title (existing)
 *   - If session.isChannelBot: full 12-tool channel bot vocabulary (Stage 2)
 *   - If session has channelId but not isChannelBot (i.e. thread): a
 *     subset of channel tools so threads can communicate back to channel
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AddressInfo } from "node:net";
import { z } from "zod";
import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { randomUUID } from "node:crypto";

type McpToolResponse = {
    content: Array<{ type: 'text'; text: string }>
    isError: boolean
}

function ok(text: string): McpToolResponse {
    return { content: [{ type: 'text' as const, text }], isError: false }
}

function err(text: string): McpToolResponse {
    return { content: [{ type: 'text' as const, text }], isError: true }
}

export async function startHappyServer(client: ApiSessionClient) {
    // Handler that sends title updates via the client
    const handler = async (title: string) => {
        logger.debug('[hapiMCP] Changing title to:', title);
        try {
            // Send title as a summary message, similar to title generator
            client.sendClaudeSessionMessage({
                type: 'summary',
                summary: title,
                leafUuid: randomUUID()
            });

            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    };

    //
    // Create the MCP server
    //

    const mcp = new McpServer({
        name: "HAPI MCP",
        version: "1.0.0",
    });

    // Avoid TS instantiation depth issues by widening the schema type.
    const changeTitleInputSchema: z.ZodTypeAny = z.object({
        title: z.string().describe('The new title for the chat session'),
    });

    mcp.registerTool<any, any>('change_title', {
        description: 'Change the title of the current chat session',
        title: 'Change Chat Title',
        inputSchema: changeTitleInputSchema,
    }, async (args: { title: string }) => {
        const response = await handler(args.title);
        logger.debug('[hapiMCP] Response:', response);

        if (response.success) {
            return ok(`Successfully changed chat title to: "${args.title}"`);
        } else {
            return err(`Failed to change chat title: ${response.error || 'Unknown error'}`);
        }
    });

    const toolNames: string[] = ['change_title']

    // ─────────────────────────────────────────────────────────────────
    // Stage 2: Channel-bot MCP tools.
    // Register based on session metadata. Channel bot gets full vocabulary;
    // thread sessions (isChannelBot=false but channelId is set) get a
    // subset focused on read + outbound communication.
    // ─────────────────────────────────────────────────────────────────

    const metadata = client.getMetadata()
    const isChannelBot = metadata?.isChannelBot === true
    const isThreadInChannel = !isChannelBot && typeof metadata?.channelId === 'string' && metadata.channelId.length > 0

    if (isChannelBot || isThreadInChannel) {
        // send_to_channel — both bot and thread can send
        mcp.registerTool<any, any>('send_to_channel', {
            description: 'Post a text message to the channel this session is associated with. Use sparingly — prefer react_to_message for low-information acknowledgments.',
            title: 'Send to Channel',
            inputSchema: z.object({
                text: z.string().describe('The message text to post to the channel'),
            }) as z.ZodTypeAny,
        }, async (args: { text: string }) => {
            try {
                const result = await client.sendToChannel(args.text)
                return ok(`Posted to channel (messageId=${result.messageId}, seq=${result.seq})`)
            } catch (e) {
                return err(`send_to_channel failed: ${e instanceof Error ? e.message : String(e)}`)
            }
        })
        toolNames.push('send_to_channel')

        // react_to_message — both bot and thread
        mcp.registerTool<any, any>('react_to_message', {
            description: 'React to a channel message with an emoji (Slack-style toggle: same emoji removes it). Examples: 👀 (seen), 👍 (agree), 🤔 (thinking), ✅ (done), ⏳ (working on it).',
            title: 'React to Message',
            inputSchema: z.object({
                messageId: z.string().describe('The id of the channel message to react to'),
                emoji: z.string().describe('A single emoji character'),
            }) as z.ZodTypeAny,
        }, async (args: { messageId: string; emoji: string }) => {
            try {
                const r = await client.reactToMessage(args.messageId, args.emoji)
                return ok(`Reaction ${r.result}: ${args.emoji} on ${args.messageId}`)
            } catch (e) {
                return err(`react_to_message failed: ${e instanceof Error ? e.message : String(e)}`)
            }
        })
        toolNames.push('react_to_message')

        // list_threads — both bot and thread (read)
        mcp.registerTool<any, any>('list_threads', {
            description: 'List all threads in this channel with their status (active/completed/archived), visibility, and last activity.',
            title: 'List Channel Threads',
            inputSchema: z.object({}) as z.ZodTypeAny,
        }, async () => {
            try {
                const r = await client.botListThreads()
                return ok(JSON.stringify(r.threads, null, 2))
            } catch (e) {
                return err(`list_threads failed: ${e instanceof Error ? e.message : String(e)}`)
            }
        })
        toolNames.push('list_threads')

        // get_thread — both
        mcp.registerTool<any, any>('get_thread', {
            description: 'Get full info about a specific thread by id (status, todos, last activity).',
            title: 'Get Thread',
            inputSchema: z.object({
                threadId: z.string(),
            }) as z.ZodTypeAny,
        }, async (args: { threadId: string }) => {
            try {
                const r = await client.botGetThread(args.threadId)
                return ok(JSON.stringify(r.thread, null, 2))
            } catch (e) {
                return err(`get_thread failed: ${e instanceof Error ? e.message : String(e)}`)
            }
        })
        toolNames.push('get_thread')

        // get_channel_history — both
        mcp.registerTool<any, any>('get_channel_history', {
            description: 'Read past messages from this channel. Used after wake-up / restart to catch up on context.',
            title: 'Get Channel History',
            inputSchema: z.object({
                beforeSeq: z.number().optional().describe('Return messages with seq < this value'),
                limit: z.number().optional().describe('Maximum number of messages to return (default 50)'),
            }) as z.ZodTypeAny,
        }, async (args: { beforeSeq?: number; limit?: number }) => {
            try {
                const r = await client.botGetChannelHistory(args)
                return ok(JSON.stringify(r.messages, null, 2))
            } catch (e) {
                return err(`get_channel_history failed: ${e instanceof Error ? e.message : String(e)}`)
            }
        })
        toolNames.push('get_channel_history')

        // list_channel_members — both
        mcp.registerTool<any, any>('list_channel_members', {
            description: 'List the human members of this channel (userId + displayName + role). Useful for @-mentioning specific people.',
            title: 'List Channel Members',
            inputSchema: z.object({}) as z.ZodTypeAny,
        }, async () => {
            try {
                const r = await client.botListChannelMembers()
                return ok(JSON.stringify(r.members, null, 2))
            } catch (e) {
                return err(`list_channel_members failed: ${e instanceof Error ? e.message : String(e)}`)
            }
        })
        toolNames.push('list_channel_members')

        // send_to_thread — bot can inject into siblings; threads can too (Lead-Teammate)
        mcp.registerTool<any, any>('send_to_thread', {
            description: 'Inject a message into another thread in this channel. Useful for the channel bot (Lead) to push context to a teammate thread, or for one thread to ping another.',
            title: 'Send to Thread',
            inputSchema: z.object({
                threadId: z.string(),
                text: z.string(),
            }) as z.ZodTypeAny,
        }, async (args: { threadId: string; text: string }) => {
            try {
                const r = await client.botSendToThread(args.threadId, args.text)
                return ok(`Sent to thread (messageId=${r.messageId})`)
            } catch (e) {
                return err(`send_to_thread failed: ${e instanceof Error ? e.message : String(e)}`)
            }
        })
        toolNames.push('send_to_thread')
    }

    if (isChannelBot) {
        // Channel-bot-only tools: spawn / cancel / pin / noop

        mcp.registerTool<any, any>('spawn_thread', {
            description: 'Create a new task thread in this channel. The thread runs as a sub-agent session and reports back via send_to_channel.',
            title: 'Spawn Thread',
            inputSchema: z.object({
                title: z.string().describe('Short title for the thread (shown in channel as a card)'),
                prompt: z.string().describe('The initial task prompt for the thread agent'),
                flavor: z.enum(['claude', 'codex', 'cursor', 'gemini', 'opencode']).optional(),
                model: z.string().optional(),
            }) as z.ZodTypeAny,
        }, async (args: { title: string; prompt: string; flavor?: any; model?: string }) => {
            try {
                const r = await client.botSpawnThread(args)
                return ok(`Thread spawned: ${r.threadSessionId}`)
            } catch (e) {
                return err(`spawn_thread failed: ${e instanceof Error ? e.message : String(e)}`)
            }
        })
        toolNames.push('spawn_thread')

        mcp.registerTool<any, any>('spawn_scheduled_thread', {
            description: 'Create a recurring scheduled thread in this channel. The thread runs Claude Code\'s built-in /loop on the given schedule and reports observations via send_to_channel. Auto-pinned and shared.',
            title: 'Spawn Scheduled Thread',
            inputSchema: z.object({
                title: z.string(),
                prompt: z.string().describe('The recurring task to perform on each loop iteration'),
                schedule: z.string().describe('Cron expression or natural-language interval, e.g. "*/15 * * * *" or "every 30m"'),
                flavor: z.enum(['claude', 'codex', 'cursor', 'gemini', 'opencode']).optional(),
                model: z.string().optional(),
            }) as z.ZodTypeAny,
        }, async (args: { title: string; prompt: string; schedule: string; flavor?: any; model?: string }) => {
            try {
                const r = await client.botSpawnScheduledThread(args)
                return ok(`Scheduled thread spawned and pinned: ${r.threadSessionId}`)
            } catch (e) {
                return err(`spawn_scheduled_thread failed: ${e instanceof Error ? e.message : String(e)}`)
            }
        })
        toolNames.push('spawn_scheduled_thread')

        mcp.registerTool<any, any>('cancel_thread', {
            description: 'Cancel a running thread by id. Use when the thread is going off-track or no longer needed.',
            title: 'Cancel Thread',
            inputSchema: z.object({
                threadId: z.string(),
                reason: z.string().optional(),
            }) as z.ZodTypeAny,
        }, async (args: { threadId: string; reason?: string }) => {
            try {
                await client.botCancelThread(args.threadId, args.reason)
                return ok(`Thread ${args.threadId} canceled`)
            } catch (e) {
                return err(`cancel_thread failed: ${e instanceof Error ? e.message : String(e)}`)
            }
        })
        toolNames.push('cancel_thread')

        mcp.registerTool<any, any>('pin_thread', {
            description: 'Pin a thread to the channel header. Pinned threads appear as chips visible to all members.',
            title: 'Pin Thread',
            inputSchema: z.object({ threadId: z.string() }) as z.ZodTypeAny,
        }, async (args: { threadId: string }) => {
            try {
                await client.botPinThread(args.threadId)
                return ok(`Thread ${args.threadId} pinned`)
            } catch (e) {
                return err(`pin_thread failed: ${e instanceof Error ? e.message : String(e)}`)
            }
        })
        toolNames.push('pin_thread')

        mcp.registerTool<any, any>('unpin_thread', {
            description: 'Remove a thread from the channel header chips.',
            title: 'Unpin Thread',
            inputSchema: z.object({ threadId: z.string() }) as z.ZodTypeAny,
        }, async (args: { threadId: string }) => {
            try {
                await client.botUnpinThread(args.threadId)
                return ok(`Thread ${args.threadId} unpinned`)
            } catch (e) {
                return err(`unpin_thread failed: ${e instanceof Error ? e.message : String(e)}`)
            }
        })
        toolNames.push('unpin_thread')

        mcp.registerTool<any, any>('noop', {
            description: 'Acknowledge a strong-signal message without producing any visible artifact in the channel. Use this when you must respond (per the strong-signal rule) but have nothing useful to add.',
            title: 'Noop',
            inputSchema: z.object({}) as z.ZodTypeAny,
        }, async () => {
            return ok('Acknowledged silently.')
        })
        toolNames.push('noop')
    }

    const transport = new StreamableHTTPServerTransport({
        // NOTE: Returning session id here will result in claude
        // sdk spawn to fail with `Invalid Request: Server already initialized`
        sessionIdGenerator: undefined
    });
    await mcp.connect(transport);

    //
    // Create the HTTP server
    //

    const server = createServer(async (req, res) => {
        try {
            await transport.handleRequest(req, res);
        } catch (error) {
            logger.debug("Error handling request:", error);
            if (!res.headersSent) {
                res.writeHead(500).end();
            }
        }
    });

    const baseUrl = await new Promise<URL>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address() as AddressInfo;
            resolve(new URL(`http://127.0.0.1:${addr.port}`));
        });
    });

    return {
        url: baseUrl.toString(),
        toolNames,
        stop: () => {
            logger.debug('[hapiMCP] Stopping server');
            mcp.close();
            server.close();
        }
    }
}
