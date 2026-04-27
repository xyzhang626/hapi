import type { ClientToServerEvents, ServerToClientEvents } from '@hapi/protocol'
import type { DefaultEventsMap, Server, Socket } from 'socket.io'

export type SocketData = {
    namespace?: string
    userId?: number
    /**
     * Stage 2: session ids the CLI socket has reported as alive at least once.
     * On disconnect we synthesize `session-end` for each entry so the bot
     * crash-recovery watchdog fires when a CLI subprocess is killed
     * (SIGTERM / OOM) without sending a graceful `session-end` first.
     */
    trackedSessionIds?: Set<string>
}

export type SocketServer = Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>
export type SocketWithData = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>
export type CliSocketServer = Server<ServerToClientEvents, ClientToServerEvents, DefaultEventsMap, SocketData>
export type CliSocketWithData = Socket<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>
