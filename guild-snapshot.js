import { ChannelType } from "discord.js";

function normalizeChannelType(type) {
  switch (type) {
    case ChannelType.GuildText:
      return "text";
    case ChannelType.GuildVoice:
      return "voice";
    case ChannelType.GuildCategory:
      return "category";
    case ChannelType.GuildForum:
      return "forum";
    case ChannelType.GuildAnnouncement:
      return "announcement";
    case ChannelType.GuildStageVoice:
      return "stage";
    default:
      return "other";
  }
}

function formatOverwriteTarget(guild, channel, overwrite) {
  if (overwrite.id === guild.id) {
    return {
      target: "everyone",
      name: "@everyone",
      allow: overwrite.allow.toArray(),
      deny: overwrite.deny.toArray(),
    };
  }

  const role = guild.roles.cache.get(overwrite.id);
  const member = guild.members.cache.get(overwrite.id);

  if (role) {
    return {
      target: "role",
      name: role.name,
      allow: overwrite.allow.toArray(),
      deny: overwrite.deny.toArray(),
    };
  }

  if (member) {
    return {
      target: "member",
      name: member.user.tag,
      allow: overwrite.allow.toArray(),
      deny: overwrite.deny.toArray(),
    };
  }

  return {
    target: "unknown",
    name: overwrite.id,
    allow: overwrite.allow.toArray(),
    deny: overwrite.deny.toArray(),
  };
}

function toDetailedChannelSnapshot(guild, channel) {
  return {
    id: channel.id,
    name: channel.name,
    type: normalizeChannelType(channel.type),
    parentId: channel.parentId || null,
    topic: "topic" in channel ? channel.topic || null : null,
    position: channel.rawPosition,
    nsfw: "nsfw" in channel ? Boolean(channel.nsfw) : false,
    rateLimitPerUser: "rateLimitPerUser" in channel ? channel.rateLimitPerUser || 0 : 0,
    permissionOverwrites: [...channel.permissionOverwrites.cache.values()].map((overwrite) =>
      formatOverwriteTarget(guild, channel, overwrite),
    ),
  };
}

function toCompactChannelSnapshot(channel) {
  return {
    name: channel.name,
    type: normalizeChannelType(channel.type),
    topic: "topic" in channel ? channel.topic || null : null,
  };
}

export async function buildPlannerSnapshot(guild) {
  await guild.channels.fetch();
  await guild.roles.fetch();

  const categories = [...guild.channels.cache.values()]
    .filter((channel) => channel?.type === ChannelType.GuildCategory)
    .sort((left, right) => left.rawPosition - right.rawPosition)
    .map((category) => ({
      name: category.name,
      channels: [...guild.channels.cache.values()]
        .filter(
          (channel) =>
            channel &&
            channel.parentId === category.id &&
            (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildVoice),
        )
        .sort((left, right) => left.rawPosition - right.rawPosition)
        .map((channel) => toCompactChannelSnapshot(channel)),
    }))
    .slice(0, 12);

  const uncategorizedChannels = [...guild.channels.cache.values()]
    .filter(
      (channel) =>
        channel &&
        !channel.parentId &&
        channel.type !== ChannelType.GuildCategory &&
        (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildVoice),
    )
    .sort((left, right) => left.rawPosition - right.rawPosition)
    .map((channel) => toCompactChannelSnapshot(channel))
    .slice(0, 20);

  const roles = [...guild.roles.cache.values()]
    .filter((role) => role.id !== guild.id)
    .sort((left, right) => right.position - left.position)
    .map((role) => ({
      name: role.name,
      colorHex: role.hexColor === "#000000" ? null : role.hexColor,
      permissions: role.permissions.toArray().slice(0, 20),
      managed: role.managed,
    }))
    .slice(0, 25);

  return {
    guildName: guild.name,
    memberCount: guild.memberCount,
    roles,
    categories,
    uncategorizedChannels,
    systemChannels: {
      system: guild.systemChannel?.name || null,
      rules: guild.rulesChannel?.name || null,
      updates: guild.publicUpdatesChannel?.name || null,
    },
  };
}

export async function buildBackupSnapshot(guild, metadata = {}) {
  await guild.channels.fetch();
  await guild.roles.fetch();

  const roles = [...guild.roles.cache.values()]
    .sort((left, right) => right.position - left.position)
    .map((role) => ({
      id: role.id,
      name: role.name,
      colorHex: role.hexColor === "#000000" ? null : role.hexColor,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: role.permissions.toArray(),
      managed: role.managed,
      position: role.position,
      isEveryone: role.id === guild.id,
    }));

  const categories = [...guild.channels.cache.values()]
    .filter((channel) => channel?.type === ChannelType.GuildCategory)
    .sort((left, right) => left.rawPosition - right.rawPosition)
    .map((category) => ({
      ...toDetailedChannelSnapshot(guild, category),
      channels: [...guild.channels.cache.values()]
        .filter((channel) => channel && channel.parentId === category.id)
        .sort((left, right) => left.rawPosition - right.rawPosition)
        .map((channel) => toDetailedChannelSnapshot(guild, channel)),
    }));

  const uncategorizedChannels = [...guild.channels.cache.values()]
    .filter((channel) => channel && !channel.parentId && channel.type !== ChannelType.GuildCategory)
    .sort((left, right) => left.rawPosition - right.rawPosition)
    .map((channel) => toDetailedChannelSnapshot(guild, channel));

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    metadata,
    guild: {
      id: guild.id,
      name: guild.name,
      memberCount: guild.memberCount,
      systemChannelId: guild.systemChannelId || null,
      rulesChannelId: guild.rulesChannelId || null,
      publicUpdatesChannelId: guild.publicUpdatesChannelId || null,
    },
    roles,
    categories,
    uncategorizedChannels,
  };
}
