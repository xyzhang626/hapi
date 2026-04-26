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
        const result: StoredChannel[] = []
        for (const channel of this.channels.values()) {
            if (channel.namespace !== namespace) continue
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
        this.channels.delete(channelId)
        this.membership.delete(channelId)
        this.publisher.emit({
            type: 'channel-removed',
            channelId,
            namespace
        })
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
