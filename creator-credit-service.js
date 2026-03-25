import { ChannelType, PermissionFlagsBits } from "discord.js";

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function shuffle(values) {
  const result = [...values];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

export class CreatorCreditService {
  constructor({ enabled, message }) {
    this.enabled = enabled;
    this.message = String(message || "").trim();
  }

  isLikelyPrivate(channel, guild) {
    const everyonePermissions = channel.permissionsFor(guild.roles.everyone);
    return !everyonePermissions?.has(PermissionFlagsBits.ViewChannel);
  }

  isLowPriority(channelName) {
    const normalized = normalizeName(channelName);
    return (
      normalized.includes("rules") ||
      normalized.includes("welcome") ||
      normalized.includes("admin") ||
      normalized.includes("mod") ||
      normalized.includes("staff") ||
      normalized.includes("log")
    );
  }

  async announceInRandomChannel(guild) {
    if (!this.enabled || !this.message) {
      return { sent: false, reason: "disabled" };
    }

    await guild.channels.fetch();

    const me = guild.members.me ?? (await guild.members.fetchMe());
    const textChannels = [...guild.channels.cache.values()].filter(
      (channel) =>
        channel.type === ChannelType.GuildText &&
        channel.permissionsFor(me)?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
        ]),
    );

    const publicChannels = textChannels.filter((channel) => !this.isLikelyPrivate(channel, guild));
    const preferredChannels = publicChannels.filter((channel) => !this.isLowPriority(channel.name));
    const candidateChannels =
      preferredChannels.length > 0 ? preferredChannels : publicChannels.length > 0 ? publicChannels : textChannels;

    const selectedChannel = shuffle(candidateChannels)[0];
    if (!selectedChannel) {
      return { sent: false, reason: "no-channel" };
    }

    await selectedChannel.send(this.message);
    return {
      sent: true,
      channelName: selectedChannel.name,
    };
  }
}
