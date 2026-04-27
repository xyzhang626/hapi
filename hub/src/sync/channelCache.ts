import type { StoredChannel, StoredChannelMember } from '../store/types'
import type { Store } from '../store'
import type { EventPublisher } from './eventPublisher'

export class ChannelCache {
    private readonly channels: Map<string, StoredChannel> = new Map()
    private readonly membership: Map<string, Set<string>> = new Map()

    constructor(
        private readonly store: Store,
        private readonly publisher: EventPublisher
    ) {
    }

    reloadAll(): void {
        this.channels.clear()
        this.membership.clear()

        const allChannels = this.store.channels.getAllChannels()
        for (const channel of allChannels) {
            this.channels.set(channel.id, channel)
            const members = this.store.channels.getMembers(channel.id)
            this.membership.set(channel.id, new Set(members.map((m) => m.userId)))
        }
    }

    getChannel(channelId: string, namespace: string): StoredChannel | null {
        const channel = this.channels.get(channelId)
        if (!channel || channel.namespace !== namespace) {
            return null
        }
        return channel
    }

    getChannelNamespace(channelId: string): string | undefined {
        return this.channels.get(channelId)?.namespace
    }

    getChannelsForUser(namespace: string, userId: string): StoredChannel[] {
        // Stage 2: cross-namespace by membership. Bob in ns=bob who joined
        // Alice's #engineering (ns=alice) needs to see that channel; the
        // earlier `channel.namespace !== namespace` filter dropped invited
        // members. Membership is the authoritative gate.
        void namespace
        const result: StoredChannel[] = []
        for (const channel of this.channels.values()) {
            const members = this.membership.get(channel.id)
            if (members?.has(userId)) {
                result.push(channel)
            }
        }
        return result
    }

    isMember(channelId: string, userId: string): boolean {
        const members = this.membership.get(channelId)
        return members?.has(userId) ?? false
    }

    getMembers(channelId: string): StoredChannelMember[] {
        return this.store.channels.getMembers(channelId)
    }

    getMemberUserIds(channelId: string): string[] {
        return this.getMembers(channelId).map((m) => m.userId)
    }

    addChannel(channel: StoredChannel): void {
        this.channels.set(channel.id, channel)
        this.membership.set(channel.id, new Set())
        this.publisher.emit({
            type: 'channel-added',
            channelId: channel.id,
            namespace: channel.namespace,
            data: channel
        })
    }

    updateChannel(channelId: string, namespace: string): void {
        const channel = this.store.channels.getChannel(channelId, namespace)
        if (!channel) {
            this.channels.delete(channelId)
            return
        }
        this.channels.set(channelId, channel)
        this.publisher.emit({
            type: 'channel-updated',
            channelId,
            namespace,
            data: channel
        })
    }

    removeChannel(channelId: string, namespace: string): void {
        // Emit BEFORE wiping local state so the SSE membership filter still
        // recognizes connected users as members of this channel and delivers
        // the channel-removed event. Otherwise sseManager's channel-membership
        // gate (sseManager.ts) will drop the event for the very users who
        // most need to see it.
        this.publisher.emit({
            type: 'channel-removed',
            channelId,
            namespace
        })
        this.channels.delete(channelId)
        this.membership.delete(channelId)
    }

    addMember(channelId: string, userId: string, namespace: string): void {
        let members = this.membership.get(channelId)
        if (!members) {
            members = new Set()
            this.membership.set(channelId, members)
        }
        members.add(userId)
        this.publisher.emit({
            type: 'channel-member-added',
            channelId,
            namespace,
            userId
        })
    }

    removeMember(channelId: string, userId: string, namespace: string): void {
        const members = this.membership.get(channelId)
        if (members) {
            members.delete(userId)
        }
        this.publisher.emit({
            type: 'channel-member-removed',
            channelId,
            namespace,
            userId
        })
    }
}
