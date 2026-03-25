import { ChannelType, EmbedBuilder, PermissionFlagsBits } from "discord.js";

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePermission(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

const knownChannelKinds = new Set([
  "standard",
  "rules",
  "welcome",
  "role-selection",
  "social-feed",
  "admin",
  "announcements",
]);

const permissionLookup = new Map(
  Object.keys(PermissionFlagsBits).map((name) => [normalizePermission(name), name]),
);

function resolvePermissions(permissionNames, report) {
  const resolved = [];

  for (const permissionName of permissionNames) {
    const canonical = permissionLookup.get(normalizePermission(permissionName));
    if (!canonical) {
      report.notes.push(`Ignored unknown permission: ${permissionName}`);
      continue;
    }

    resolved.push(canonical);
  }

  return [...new Set(resolved)];
}

function isProtectedChannel(guild, channelId) {
  return (
    guild.systemChannelId === channelId ||
    guild.rulesChannelId === channelId ||
    guild.publicUpdatesChannelId === channelId
  );
}

function isManagedLeafChannel(channel) {
  return channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildVoice;
}

function createEmptyReport() {
  return {
    renamedServer: false,
    autoRoleAssignedCount: 0,
    createdRoles: [],
    updatedRoles: [],
    deletedRoles: [],
    skippedRoles: [],
    createdCategories: [],
    updatedCategories: [],
    deletedCategories: [],
    createdChannels: [],
    updatedChannels: [],
    deletedChannels: [],
    archivedChannels: [],
    notes: [],
  };
}

function toDiscordChannelType(type) {
  return type === "voice" ? ChannelType.GuildVoice : ChannelType.GuildText;
}

function buildOverwrites({ overwrites, guild, roleMap, report }) {
  const results = [];

  for (const overwrite of overwrites) {
    const targetId =
      overwrite.target === "everyone"
        ? guild.id
        : roleMap.get(normalizeName(overwrite.roleName))?.id;

    if (!targetId) {
      report.notes.push(`Skipped overwrite target: ${overwrite.roleName || overwrite.target}`);
      continue;
    }

    results.push({
      id: targetId,
      allow: resolvePermissions(overwrite.allow, report),
      deny: resolvePermissions(overwrite.deny, report),
    });
  }

  return results;
}

export class ThemeApplier {
  constructor({
    archiveCategoryName,
    allowServerRename,
    scratchDeleteUnmatched,
    autoRoleService,
    roleSelectionService,
  }) {
    this.archiveCategoryName = archiveCategoryName;
    this.allowServerRename = allowServerRename;
    this.scratchDeleteUnmatched = scratchDeleteUnmatched;
    this.autoRoleService = autoRoleService;
    this.roleSelectionService = roleSelectionService;
  }

  getDefaultRoleName() {
    return this.autoRoleService?.autoRoleName || "Member";
  }

  async apply({ guild, plan, mode }) {
    const report = createEmptyReport();
    const appliedChannels = [];

    await guild.channels.fetch();
    await guild.roles.fetch();

    if (this.allowServerRename && guild.name !== plan.server.name) {
      await guild.setName(plan.server.name);
      report.renamedServer = true;
    }

    const roleMap = await this.syncRoles(guild, plan.roles, report);
    const plannedChannelIds = new Set();

    for (const [categoryIndex, categoryPlan] of plan.categories.entries()) {
      const category = await this.ensureCategory(guild, categoryPlan, categoryIndex, report);

      for (const [channelIndex, channelPlan] of categoryPlan.channels.entries()) {
        const channel = await this.ensureChannel({
          guild,
          category,
          channelPlan,
          channelIndex,
          roleMap,
          report,
        });

        plannedChannelIds.add(channel.id);
        appliedChannels.push({
          categoryPlan,
          channelPlan,
          channel,
        });
      }
    }

    if (mode === "scratch") {
      if (this.scratchDeleteUnmatched) {
        await this.deleteUnplannedChannels(guild, plannedChannelIds, report);
        await this.deleteUnplannedCategories(guild, plan.categories, report);
        await this.deleteUnplannedRoles(guild, plan.roles, report);
        report.notes.push("Scratch mode deleted unmatched channels, categories, and roles.");
      } else {
        await this.archiveUnplannedChannels(guild, plannedChannelIds, report);
        report.notes.push("Scratch mode archived unmatched channels instead of deleting them.");
      }
    } else {
      report.notes.push("Existing mode kept unmatched channels in place.");
    }

    await this.configureSpecialChannels({
      guild,
      plan,
      appliedChannels,
      roleMap,
      report,
    });

    if (mode === "scratch" && this.scratchDeleteUnmatched) {
      await this.deleteUnplannedChannels(guild, plannedChannelIds, report);
      await this.deleteUnplannedCategories(guild, plan.categories, report);
    }

    if (this.autoRoleService) {
      try {
        const autoRoleResult = await this.autoRoleService.assignToExistingMembers(guild);
        report.autoRoleAssignedCount = autoRoleResult.assignedCount;

        if (autoRoleResult.issues.length > 0) {
          report.notes.push(`Auto role issues: ${autoRoleResult.issues.slice(0, 5).join(" | ")}`);
        } else {
          report.notes.push(`Auto role assigned to ${autoRoleResult.assignedCount} existing member(s).`);
        }
      } catch (error) {
        report.notes.push("Auto role assignment did not complete. Enable member events if you want join-time role assignment.");
      }
    }

    return report;
  }

  resolveChannelKind(categoryPlan, channelPlan) {
    const explicitKind = normalizeName(channelPlan.kind);
    if (knownChannelKinds.has(explicitKind)) {
      return explicitKind;
    }

    const categoryName = normalizeName(categoryPlan?.name);
    const channelName = normalizeName(channelPlan.name);

    if (channelName.includes("rules")) {
      return "rules";
    }

    if (channelName.includes("welcome") || channelName === "start-here") {
      return "welcome";
    }

    if (channelName.includes("role-selection") || channelName === "pick-your-roles") {
      return "role-selection";
    }

    if (
      channelName.includes("social") ||
      channelName.includes("creator") ||
      channelName.includes("clips") ||
      channelName.includes("media")
    ) {
      return "social-feed";
    }

    if (channelName.includes("announcement")) {
      return "announcements";
    }

    if (
      categoryName.includes("officer") ||
      categoryName.includes("admin") ||
      channelName.includes("officer") ||
      channelName.includes("admin") ||
      channelName.includes("mod-log") ||
      channelName.includes("staff")
    ) {
      return "admin";
    }

    return "standard";
  }

  async configureSpecialChannels({ guild, plan, appliedChannels, roleMap, report }) {
    const textChannelEntries = appliedChannels.filter(
      (entry) => entry.channel.type === ChannelType.GuildText,
    );

    const findByKind = (kind) =>
      textChannelEntries.find(
        (entry) => this.resolveChannelKind(entry.categoryPlan, entry.channelPlan) === kind,
      );

    const rulesEntry = findByKind("rules");
    const welcomeEntry = findByKind("welcome");
    const roleSelectionEntry = findByKind("role-selection");
    const socialEntry = findByKind("social-feed");
    const adminEntry = findByKind("admin");
    const announcementsEntry = findByKind("announcements");

    if (rulesEntry) {
      await this.configureRulesChannel({ guild, channel: rulesEntry.channel, report });
    }

    if (welcomeEntry) {
      await this.configureWelcomeChannel({
        guild,
        plan,
        channel: welcomeEntry.channel,
        rulesChannel: rulesEntry?.channel,
        roleSelectionChannel: roleSelectionEntry?.channel,
        socialChannel: socialEntry?.channel,
        report,
      });
    }

    if (roleSelectionEntry && this.roleSelectionService) {
      await this.configureRoleSelectionChannel({
        guild,
        plan,
        channel: roleSelectionEntry.channel,
        roleMap,
        report,
      });
    }

    if (socialEntry) {
      await this.configureSocialChannel({
        channel: socialEntry.channel,
        report,
      });
    }

    if (adminEntry) {
      await this.configureAdminChannel({
        channel: adminEntry.channel,
        report,
      });
    }

    if (announcementsEntry) {
      await this.configureAnnouncementsChannel({
        channel: announcementsEntry.channel,
        report,
      });
    }

    if (welcomeEntry) {
      await this.configureWelcomeScreen({
        guild,
        plan,
        welcomeChannel: welcomeEntry.channel,
        rulesChannel: rulesEntry?.channel,
        roleSelectionChannel: roleSelectionEntry?.channel,
        socialChannel: socialEntry?.channel,
        report,
      });
    }
  }

  async syncRoles(guild, rolePlans, report) {
    const roleMap = new Map();
    const botHighestRole = guild.members.me?.roles.highest;

    for (const rolePlan of rolePlans) {
      const existingRole = [...guild.roles.cache.values()].find(
        (role) =>
          role.id !== guild.id &&
          !role.managed &&
          normalizeName(role.name) === normalizeName(rolePlan.name),
      );

      const permissions = resolvePermissions(rolePlan.permissions, report);

      if (existingRole) {
        if (!existingRole.editable) {
          const reason =
            botHighestRole && existingRole.position >= botHighestRole.position
              ? `${rolePlan.name} (move the ThemeSmith role above this role, then run apply again)`
              : `${rolePlan.name} (Discord did not allow this role to be edited)`;

          report.skippedRoles.push(reason);
          roleMap.set(normalizeName(rolePlan.name), existingRole);
          continue;
        }

        await existingRole.edit({
          name: rolePlan.name,
          color: rolePlan.colorHex || undefined,
          hoist: rolePlan.hoist,
          mentionable: rolePlan.mentionable,
          permissions,
        });

        report.updatedRoles.push(rolePlan.name);
        roleMap.set(normalizeName(rolePlan.name), existingRole);
        continue;
      }

      const createdRole = await guild.roles.create({
        name: rolePlan.name,
        color: rolePlan.colorHex || undefined,
        hoist: rolePlan.hoist,
        mentionable: rolePlan.mentionable,
        permissions,
        reason: `AI theme role: ${rolePlan.purpose}`,
      });

      report.createdRoles.push(rolePlan.name);
      roleMap.set(normalizeName(rolePlan.name), createdRole);
    }

    return roleMap;
  }

  async ensureCategory(guild, categoryPlan, position, report) {
    const existingCategory = [...guild.channels.cache.values()].find(
      (channel) =>
        channel.type === ChannelType.GuildCategory &&
        normalizeName(channel.name) === normalizeName(categoryPlan.name),
    );

    if (existingCategory) {
      await existingCategory.edit({
        name: categoryPlan.name,
        position,
      });
      report.updatedCategories.push(categoryPlan.name);
      return existingCategory;
    }

    const createdCategory = await guild.channels.create({
      name: categoryPlan.name,
      type: ChannelType.GuildCategory,
      position,
      reason: `AI theme category: ${categoryPlan.purpose}`,
    });

    report.createdCategories.push(categoryPlan.name);
    return createdCategory;
  }

  async ensureChannel({ guild, category, channelPlan, channelIndex, roleMap, report }) {
    const desiredType = toDiscordChannelType(channelPlan.type);
    const overwrites = buildOverwrites({
      overwrites: channelPlan.overwrites,
      guild,
      roleMap,
      report,
    });

    const existingChannel = [...guild.channels.cache.values()].find(
      (channel) =>
        channel.type === desiredType && normalizeName(channel.name) === normalizeName(channelPlan.name),
    );

    if (existingChannel?.type === ChannelType.GuildText) {
      await existingChannel.edit({
        name: channelPlan.name,
        parent: category.id,
        topic: channelPlan.topic || null,
        rateLimitPerUser: channelPlan.slowmodeSeconds || 0,
        position: channelIndex,
      });
      await existingChannel.permissionOverwrites.set(overwrites);
      report.updatedChannels.push(channelPlan.name);
      return existingChannel;
    }

    if (existingChannel?.type === ChannelType.GuildVoice) {
      await existingChannel.edit({
        name: channelPlan.name,
        parent: category.id,
        position: channelIndex,
      });
      await existingChannel.permissionOverwrites.set(overwrites);
      report.updatedChannels.push(channelPlan.name);
      return existingChannel;
    }

    const createdChannel = await guild.channels.create({
      name: channelPlan.name,
      type: desiredType,
      parent: category.id,
      topic: desiredType === ChannelType.GuildText ? channelPlan.topic : undefined,
      rateLimitPerUser: desiredType === ChannelType.GuildText ? channelPlan.slowmodeSeconds || 0 : undefined,
      permissionOverwrites: overwrites,
      reason: `AI theme channel: ${channelPlan.purpose}`,
    });

    report.createdChannels.push(channelPlan.name);
    return createdChannel;
  }

  async upsertGuideMessage({ channel, title, description, color, pin = false, fields = [] }) {
    const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);

    if (fields.length > 0) {
      embed.addFields(fields);
    }

    const recentMessages = await channel.messages.fetch({ limit: 20 });
    const existingMessage = recentMessages.find(
      (message) =>
        message.author.id === channel.client.user.id &&
        message.embeds[0]?.title === title,
    );

    const payload = {
      embeds: [embed],
      components: [],
    };

    const message = existingMessage
      ? await existingMessage.edit(payload)
      : await channel.send(payload);

    if (pin && !message.pinned) {
      await message.pin().catch(() => null);
    }

    return message;
  }

  async configureRulesChannel({ guild, channel, report }) {
    await this.upsertGuideMessage({
      channel,
      title: "Server Rules",
      color: 0xff6b35,
      pin: true,
      description: [
        "1. Respect every agent. No harassment, hate, threats, or personal attacks.",
        "2. Keep each conversation in the right channel so the server stays clean and useful.",
        "3. No spam, scams, malicious links, mass pings, or fake giveaways.",
        "4. Keep all content safe for work and follow Discord Terms of Service.",
        "5. Credit creators when you share builds, clips, screenshots, or strategy work.",
        "6. Debate the meta, not each other. PvP and balance arguments must stay civil.",
        "7. Use feedback, support, and admin channels properly instead of derailing public rooms.",
        "8. Staff may remove content, restrict access, or remove members who ignore these rules.",
      ].join("\n"),
    });

    if (guild.features.includes("COMMUNITY")) {
      await guild.setRulesChannel(channel, "ThemeSmith configured the server rules channel");
      report.notes.push(`Configured rules channel: ${channel.name}`);
    } else {
      report.notes.push(`Rules message posted in ${channel.name}. Enable Community in Discord if you want it set as the official rules channel.`);
    }
  }

  async configureWelcomeChannel({
    guild,
    plan,
    channel,
    rulesChannel,
    roleSelectionChannel,
    socialChannel,
    report,
  }) {
    const lines = [
      `Welcome to **${plan.server.name}**.`,
      "",
      plan.server.description,
      "",
      rulesChannel ? `Read <#${rulesChannel.id}> before posting.` : "Read the rules before posting.",
      `Every new member is automatically given the **${this.getDefaultRoleName()}** role.`,
      roleSelectionChannel
        ? `Use <#${roleSelectionChannel.id}> to pick any optional specialty roles.`
        : "Optional specialty roles can be managed by staff.",
      socialChannel
        ? `Post your creator drops, clips, uploads, and socials in <#${socialChannel.id}>.`
        : "Use the media and social channels for clips, uploads, and creator drops.",
    ];

    await this.upsertGuideMessage({
      channel,
      title: "Welcome",
      color: 0x00aeef,
      pin: true,
      description: lines.join("\n"),
    });

    await guild
      .setSystemChannel(channel, "ThemeSmith configured the server welcome channel")
      .then(() => {
        report.notes.push(`Configured system welcome channel: ${channel.name}`);
      })
      .catch(() => {
        report.notes.push(`Could not set ${channel.name} as the system welcome channel.`);
      });
  }

  async configureRoleSelectionChannel({ guild, plan, channel, roleMap, report }) {
    const result = await this.roleSelectionService.upsertMessage({
      channel,
      guild,
      serverName: plan.server.name,
      rolePlans: plan.roles,
      roleMap,
    });

    if (result.optionsCount > 0) {
      report.notes.push(`Configured role-selection menu in ${channel.name} with ${result.optionsCount} self-assignable roles.`);
    } else {
      report.notes.push(`Role-selection channel ${channel.name} is ready, but no self-assignable roles were provided in the plan.`);
    }
  }

  async configureSocialChannel({ channel, report }) {
    await this.upsertGuideMessage({
      channel,
      title: "Social Uploads",
      color: 0xc13bff,
      description: [
        "Drop your latest clips, YouTube videos, TikToks, shorts, livestreams, and creator posts here.",
        "",
        "Best practice:",
        "- add a short caption",
        "- say what build or activity the clip is about",
        "- include the platform or link when it matters",
        "- avoid repost spam and keep self-promo high quality",
      ].join("\n"),
    });

    report.notes.push(`Configured social feed guidance in ${channel.name}`);
  }

  async configureAdminChannel({ channel, report }) {
    await this.upsertGuideMessage({
      channel,
      title: "Admin Notes",
      color: 0xf4c542,
      description: [
        "Use this admin lane for moderation decisions, content planning, event coordination, and internal follow-up.",
        "",
        "Recommended uses:",
        "- log moderation actions",
        "- queue announcements and creator features",
        "- review feedback and bug reports",
        "- coordinate raids, events, and staff coverage",
      ].join("\n"),
    });

    report.notes.push(`Configured admin guidance in ${channel.name}`);
  }

  async configureAnnouncementsChannel({ channel, report }) {
    await this.upsertGuideMessage({
      channel,
      title: "Announcements Channel",
      color: 0xe6e6e6,
      description: "This channel is for official updates, launches, patch notes, and important notices from staff.",
    });

    report.notes.push(`Configured announcement guidance in ${channel.name}`);
  }

  async configureWelcomeScreen({
    guild,
    plan,
    welcomeChannel,
    rulesChannel,
    roleSelectionChannel,
    socialChannel,
    report,
  }) {
    if (!guild.features.includes("COMMUNITY")) {
      return;
    }

    const welcomeChannels = [
      welcomeChannel
        ? {
            channel: welcomeChannel,
            description: "Start here and learn how the server works.",
            emoji: "🧭",
          }
        : null,
      rulesChannel
        ? {
            channel: rulesChannel,
            description: "Read the rules and community expectations.",
            emoji: "📜",
          }
        : null,
      roleSelectionChannel
        ? {
            channel: roleSelectionChannel,
            description: "Pick optional tags and specialties.",
            emoji: "🎯",
          }
        : null,
      socialChannel
        ? {
            channel: socialChannel,
            description: "Share social uploads, videos, and clips.",
            emoji: "📣",
          }
        : null,
    ]
      .filter(Boolean)
      .slice(0, 5);

    try {
      await guild.editWelcomeScreen({
        enabled: true,
        description: plan.server.description,
        welcomeChannels,
      });

      report.notes.push("Configured the Discord welcome screen.");
    } catch {
      report.notes.push("Could not configure the Discord welcome screen. This may require Community settings in Discord.");
    }
  }

  async archiveUnplannedChannels(guild, plannedChannelIds, report) {
    const archiveCategory = await this.ensureArchiveCategory(guild, report);

    for (const channel of guild.channels.cache.values()) {
      if (!isManagedLeafChannel(channel)) {
        continue;
      }

      if (plannedChannelIds.has(channel.id) || isProtectedChannel(guild, channel.id)) {
        continue;
      }

      await channel.edit({ parent: archiveCategory.id });
      report.archivedChannels.push(channel.name);
    }
  }

  async deleteUnplannedChannels(guild, plannedChannelIds, report) {
    const channels = [...guild.channels.cache.values()].sort((left, right) => right.rawPosition - left.rawPosition);

    for (const channel of channels) {
      if (!isManagedLeafChannel(channel)) {
        continue;
      }

      if (plannedChannelIds.has(channel.id) || isProtectedChannel(guild, channel.id)) {
        continue;
      }

      if (!channel.deletable) {
        report.notes.push(`Skipped undeletable channel: ${channel.name}`);
        continue;
      }

      await channel.delete("Theme bot scratch cleanup removed an unmatched channel");
      report.deletedChannels.push(channel.name);
    }
  }

  async deleteUnplannedCategories(guild, plannedCategories, report) {
    const plannedCategoryNames = new Set(plannedCategories.map((category) => normalizeName(category.name)));
    const categories = [...guild.channels.cache.values()]
      .filter((channel) => channel.type === ChannelType.GuildCategory)
      .sort((left, right) => right.rawPosition - left.rawPosition);

    for (const category of categories) {
      if (normalizeName(category.name) === normalizeName(this.archiveCategoryName)) {
        if (!this.scratchDeleteUnmatched) {
          continue;
        }
      }

      if (plannedCategoryNames.has(normalizeName(category.name)) || isProtectedChannel(guild, category.id)) {
        continue;
      }

      const childCount = [...guild.channels.cache.values()].filter((channel) => channel.parentId === category.id).length;
      if (childCount > 0) {
        continue;
      }

      if (!category.deletable) {
        report.notes.push(`Skipped undeletable category: ${category.name}`);
        continue;
      }

      await category.delete("Theme bot scratch cleanup removed an unmatched category");
      report.deletedCategories.push(category.name);
    }
  }

  async deleteUnplannedRoles(guild, plannedRoles, report) {
    const plannedRoleNames = new Set(plannedRoles.map((role) => normalizeName(role.name)));
    const roles = [...guild.roles.cache.values()].sort((left, right) => right.position - left.position);
    const botHighestRole = guild.members.me?.roles.highest;

    for (const role of roles) {
      if (role.id === guild.id) {
        continue;
      }

      if (plannedRoleNames.has(normalizeName(role.name))) {
        continue;
      }

      if (role.managed) {
        report.skippedRoles.push(`${role.name} (managed by Discord or another bot)`);
        continue;
      }

      if (!role.editable) {
        const reason =
          botHighestRole && role.position >= botHighestRole.position
            ? `${role.name} (move the ThemeSmith role above this role, then run apply again)`
            : `${role.name} (Discord did not allow this role to be edited)`;

        report.skippedRoles.push(reason);
        continue;
      }

      await role.delete("Theme bot scratch cleanup removed an unmatched role");
      report.deletedRoles.push(role.name);
    }

    if (report.skippedRoles.length > 0) {
      report.notes.push(`Skipped roles: ${report.skippedRoles.slice(0, 8).join(" | ")}`);
    }
  }

  async ensureArchiveCategory(guild, report) {
    const existingCategory = [...guild.channels.cache.values()].find(
      (channel) =>
        channel.type === ChannelType.GuildCategory &&
        normalizeName(channel.name) === normalizeName(this.archiveCategoryName),
    );

    if (existingCategory) {
      return existingCategory;
    }

    const createdCategory = await guild.channels.create({
      name: this.archiveCategoryName,
      type: ChannelType.GuildCategory,
      reason: "Archive for unmatched channels during scratch mode",
    });

    report.createdCategories.push(this.archiveCategoryName);
    return createdCategory;
  }
}
