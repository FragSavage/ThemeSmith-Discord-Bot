import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } from "discord.js";

const CUSTOM_ID_PREFIX = "themesmith-role-select:";

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function clamp(value, limit) {
  const text = String(value || "").trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 3)}...`;
}

export class RoleSelectionService {
  constructor({ defaultRoleName }) {
    this.defaultRoleName = defaultRoleName;
  }

  findRole(guild, roleName, roleMap) {
    return (
      roleMap.get(normalizeName(roleName)) ||
      [...guild.roles.cache.values()].find(
        (role) => role.id !== guild.id && normalizeName(role.name) === normalizeName(roleName),
      )
    );
  }

  buildOptions({ guild, rolePlans, roleMap }) {
    return rolePlans
      .filter((rolePlan) => rolePlan.selfAssignable)
      .map((rolePlan) => {
        const role = this.findRole(guild, rolePlan.name, roleMap);
        if (!role || !role.editable) {
          return null;
        }

        return {
          label: clamp(role.name, 100),
          value: role.id,
          description: clamp(rolePlan.purpose, 100),
        };
      })
      .filter(Boolean)
      .slice(0, 25);
  }

  getCustomId(guildId) {
    return `${CUSTOM_ID_PREFIX}${guildId}`;
  }

  async upsertMessage({ channel, guild, serverName, rolePlans, roleMap }) {
    const options = this.buildOptions({ guild, rolePlans, roleMap });
    const defaultRoleName = this.defaultRoleName || "Member";
    const embed = new EmbedBuilder()
      .setColor(0xff6b35)
      .setTitle("Choose Your Roles")
      .setDescription(
        [
          `Every member receives the **${defaultRoleName}** role automatically in **${serverName}**.`,
          "",
          "Use the selector below to add or remove optional specialty roles for your account.",
          "Pick the tags that match how you play, what content you want, or what part of the community you want to be known for.",
        ].join("\n"),
      );

    let components = [];
    if (options.length > 0) {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(this.getCustomId(guild.id))
        .setPlaceholder("Select your optional specialty roles")
        .setMinValues(0)
        .setMaxValues(options.length)
        .addOptions(options);

      components = [new ActionRowBuilder().addComponents(menu)];
    } else {
      embed.addFields({
        name: "Setup Note",
        value: "No self-assignable roles are configured yet. Add roles with `selfAssignable: true` in the plan to populate this menu.",
      });
    }

    const recentMessages = await channel.messages.fetch({ limit: 20 });
    const existingMessage = recentMessages.find(
      (message) =>
        message.author.id === channel.client.user.id &&
        message.embeds[0]?.title === "Choose Your Roles",
    );

    const payload = {
      embeds: [embed],
      components,
    };

    const message = existingMessage
      ? await existingMessage.edit(payload)
      : await channel.send(payload);

    if (!message.pinned) {
      await message.pin().catch(() => null);
    }

    return {
      optionsCount: options.length,
    };
  }

  async handleInteraction(interaction) {
    if (!interaction.isStringSelectMenu() || !interaction.customId.startsWith(CUSTOM_ID_PREFIX)) {
      return false;
    }

    const member =
      interaction.member && "roles" in interaction.member
        ? interaction.member
        : await interaction.guild.members.fetch(interaction.user.id);
    const allRoleIds = interaction.component.options.map((option) => option.value);
    const selectedRoleIds = new Set(interaction.values);
    const rolesToAdd = [];
    const rolesToRemove = [];
    const skippedRoles = [];

    for (const roleId of allRoleIds) {
      const role = interaction.guild?.roles.cache.get(roleId);
      if (!role || !role.editable) {
        if (role) {
          skippedRoles.push(role.name);
        }
        continue;
      }

      const memberHasRole = member.roles.cache.has(roleId);

      if (selectedRoleIds.has(roleId) && !memberHasRole) {
        rolesToAdd.push(role);
      }

      if (!selectedRoleIds.has(roleId) && memberHasRole) {
        rolesToRemove.push(role);
      }
    }

    if (rolesToAdd.length > 0) {
      await member.roles.add(
        rolesToAdd,
        "ThemeSmith self-assigned role selection",
      );
    }

    if (rolesToRemove.length > 0) {
      await member.roles.remove(
        rolesToRemove,
        "ThemeSmith self-assigned role selection",
      );
    }

    const addedNames = rolesToAdd.map((role) => role.name);
    const removedNames = rolesToRemove.map((role) => role.name);
    const summaryParts = [];

    if (addedNames.length > 0) {
      summaryParts.push(`added: ${addedNames.join(", ")}`);
    }

    if (removedNames.length > 0) {
      summaryParts.push(`removed: ${removedNames.join(", ")}`);
    }

    if (skippedRoles.length > 0) {
      summaryParts.push(`skipped: ${skippedRoles.join(", ")}`);
    }

    if (summaryParts.length === 0) {
      summaryParts.push("No role changes were needed.");
    }

    await interaction.reply({
      content: `Role selection updated. ${summaryParts.join(" | ")}`,
      ephemeral: true,
    });

    return true;
  }
}
