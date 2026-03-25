import {
  AttachmentBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { buildPlannerSnapshot } from "./guild-snapshot.js";
import { buildPlannerPrompt, validatePlan } from "./openai-theme-planner.js";

function listOrNone(values) {
  return values.length > 0 ? values.join(", ") : "none";
}

function clamp(value, limit = 4000) {
  return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
}

function createPlanEmbed(plan, mode) {
  const categoryLines = plan.categories.map(
    (category) =>
      `- ${category.name}: ${category.channels.map((channel) => `${channel.type}:${channel.name}`).join(", ")}`,
  );

  return new EmbedBuilder()
    .setTitle(`Theme Plan (${mode})`)
    .setDescription(clamp(plan.planSummary, 4000))
    .addFields(
      {
        name: "Server Name",
        value: plan.server.name,
      },
      {
        name: "Keywords",
        value: clamp(listOrNone(plan.server.keywords), 1024),
      },
      {
        name: "Roles",
        value: clamp(listOrNone(plan.roles.map((role) => role.name)), 1024),
      },
      {
        name: "Categories",
        value: clamp(categoryLines.join("\n") || "none", 1024),
      },
      {
        name: "Rollout Notes",
        value: clamp(plan.rolloutNotes.join("\n") || "none", 1024),
      },
    );
}

function createApplyEmbed({ plan, mode, backup, report }) {
  return new EmbedBuilder()
    .setTitle(`Theme Applied (${mode})`)
    .setDescription(clamp(plan.planSummary, 4000))
    .addFields(
      {
        name: "Backup",
        value: backup.fileName,
      },
      {
        name: "Server Renamed",
        value: report.renamedServer ? "yes" : "no",
      },
      {
        name: "Created Roles",
        value: clamp(listOrNone(report.createdRoles), 1024),
      },
      {
        name: "Updated Roles",
        value: clamp(listOrNone(report.updatedRoles), 1024),
      },
      {
        name: "Deleted Roles",
        value: clamp(listOrNone(report.deletedRoles || []), 1024),
      },
      {
        name: "Skipped Roles",
        value: clamp(listOrNone(report.skippedRoles || []), 1024),
      },
      {
        name: "Created Categories",
        value: clamp(listOrNone(report.createdCategories), 1024),
      },
      {
        name: "Updated Categories",
        value: clamp(listOrNone(report.updatedCategories), 1024),
      },
      {
        name: "Deleted Categories",
        value: clamp(listOrNone(report.deletedCategories || []), 1024),
      },
      {
        name: "Created Channels",
        value: clamp(listOrNone(report.createdChannels), 1024),
      },
      {
        name: "Updated Channels",
        value: clamp(listOrNone(report.updatedChannels), 1024),
      },
      {
        name: "Deleted Channels",
        value: clamp(listOrNone(report.deletedChannels || []), 1024),
      },
      {
        name: "Archived Channels",
        value: clamp(listOrNone(report.archivedChannels), 1024),
      },
      {
        name: "Auto Role Assigned",
        value: String(report.autoRoleAssignedCount || 0),
      },
      {
        name: "Notes",
        value: clamp(listOrNone(report.notes), 1024),
      },
    );
}

function createBackupsEmbed(backups) {
  return new EmbedBuilder()
    .setTitle("Server Backups")
    .setDescription(
      backups.length === 0
        ? "No backups found for this server yet."
        : clamp(
            backups
              .map(
                (backup) =>
                  `- ${backup.fileName}\n  ${backup.createdAt || "unknown time"} | ${backup.reason || "backup"}`,
              )
              .join("\n"),
            4000,
          ),
    );
}

async function readPlanFromAttachment(attachment) {
  const isSupportedPlanFile =
    attachment.contentType?.includes("json") ||
    attachment.contentType?.includes("text") ||
    attachment.name?.toLowerCase().endsWith(".json") ||
    attachment.name?.toLowerCase().endsWith(".txt");

  if (!isSupportedPlanFile) {
    throw new Error("Upload a `.json` or `.txt` plan file.");
  }

  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error("Could not download the uploaded plan file from Discord.");
  }

  const rawText = await response.text();

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const extractedJson = extractJsonFromText(rawText);
    if (!extractedJson) {
      throw new Error("The uploaded file must contain a valid JSON plan. `.txt` files are allowed if they contain the JSON plan text.");
    }

    try {
      parsed = JSON.parse(extractedJson);
    } catch {
      throw new Error("The uploaded file contains text, but the JSON plan inside it is invalid.");
    }
  }

  return validatePlan(parsed);
}

function extractJsonFromText(rawText) {
  const trimmed = String(rawText || "").trim();
  if (!trimmed) {
    return null;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidateFromFence = fencedMatch?.[1]?.trim();
  if (candidateFromFence?.startsWith("{") && candidateFromFence.endsWith("}")) {
    return candidateFromFence;
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

export const themeCommand = {
  data: new SlashCommandBuilder()
    .setName("theme")
    .setDescription("AI theme tools for this Discord server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("prompt")
        .setDescription("Create a ChatGPT prompt file for a manual no-API theme plan.")
        .addStringOption((option) =>
          option
            .setName("concept")
            .setDescription("Describe the community and style you want.")
            .setRequired(true)
            .setMaxLength(1000),
        )
        .addStringOption((option) =>
          option
            .setName("mode")
            .setDescription("Rebuild from scratch or adapt the current server.")
            .setRequired(true)
            .addChoices(
              { name: "scratch", value: "scratch" },
              { name: "existing", value: "existing" },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("plan")
        .setDescription("Preview an AI-generated server theme plan.")
        .addStringOption((option) =>
          option
            .setName("concept")
            .setDescription("Describe the community and style you want.")
            .setRequired(true)
            .setMaxLength(1000),
        )
        .addStringOption((option) =>
          option
            .setName("mode")
            .setDescription("Rebuild from scratch or adapt the current server.")
            .setRequired(true)
            .addChoices(
              { name: "scratch", value: "scratch" },
              { name: "existing", value: "existing" },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("preview-manual")
        .setDescription("Preview a manually generated JSON or text plan file.")
        .addAttachmentOption((option) =>
          option
            .setName("plan_file")
            .setDescription("A .json or .txt file produced manually or by ChatGPT.")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("mode")
            .setDescription("How the bot should treat unmatched channels.")
            .setRequired(true)
            .addChoices(
              { name: "scratch", value: "scratch" },
              { name: "existing", value: "existing" },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("apply")
        .setDescription("Back up the server, generate an AI theme, and apply it.")
        .addStringOption((option) =>
          option
            .setName("concept")
            .setDescription("Describe the community and style you want.")
            .setRequired(true)
            .setMaxLength(1000),
        )
        .addStringOption((option) =>
          option
            .setName("mode")
            .setDescription("Rebuild from scratch or adapt the current server.")
            .setRequired(true)
            .addChoices(
              { name: "scratch", value: "scratch" },
              { name: "existing", value: "existing" },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("confirm")
            .setDescription("Type APPLY to confirm.")
            .setRequired(true)
            .setMaxLength(10),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("apply-manual")
        .setDescription("Apply a manually generated JSON or text plan file without calling OpenAI.")
        .addAttachmentOption((option) =>
          option
            .setName("plan_file")
            .setDescription("A .json or .txt file produced manually or by ChatGPT.")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("mode")
            .setDescription("Rebuild from scratch or adapt the current server.")
            .setRequired(true)
            .addChoices(
              { name: "scratch", value: "scratch" },
              { name: "existing", value: "existing" },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("confirm")
            .setDescription("Type APPLY to confirm.")
            .setRequired(true)
            .setMaxLength(10),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("backup")
        .setDescription("Create a full backup of the current server structure.")
        .addStringOption((option) =>
          option
            .setName("label")
            .setDescription("Optional label for this backup.")
            .setRequired(false)
            .setMaxLength(60),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("backups")
        .setDescription("List recent backups for this server."),
    ),

  async execute(interaction, { planner, backupStore, themeApplier }) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command only works inside a Discord server.",
        ephemeral: true,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "prompt") {
      await interaction.deferReply({ ephemeral: true });

      const concept = interaction.options.getString("concept", true);
      const mode = interaction.options.getString("mode", true);
      const snapshot = await buildPlannerSnapshot(interaction.guild);
      const promptText = buildPlannerPrompt({
        concept,
        mode,
        snapshot,
      });

      const promptFile = new AttachmentBuilder(Buffer.from(promptText, "utf8"), {
        name: `themesmith-${mode}-prompt.txt`,
      });

      await interaction.editReply({
        content:
          "Use this prompt in ChatGPT, ask it to return raw JSON only, save the result as a `.json` or `.txt` file, then use `/theme preview-manual` or `/theme apply-manual`.",
        files: [promptFile],
      });
      return;
    }

    if (subcommand === "backup") {
      await interaction.deferReply({ ephemeral: true });

      const label = interaction.options.getString("label") || "manual backup";
      const backup = await backupStore.createBackup(interaction.guild, {
        reason: "manual backup",
        label,
      });

      await interaction.editReply({
        content: `Backup saved: ${backup.fileName}`,
      });
      return;
    }

    if (subcommand === "backups") {
      await interaction.deferReply({ ephemeral: true });

      const backups = await backupStore.listBackups(interaction.guild.id, 10);
      await interaction.editReply({
        embeds: [createBackupsEmbed(backups)],
      });
      return;
    }

    if (subcommand === "preview-manual") {
      await interaction.deferReply({ ephemeral: true });

      const attachment = interaction.options.getAttachment("plan_file", true);
      const mode = interaction.options.getString("mode", true);
      const plan = await readPlanFromAttachment(attachment);

      await interaction.editReply({
        embeds: [createPlanEmbed(plan, mode)],
      });
      return;
    }

    if (subcommand === "apply-manual") {
      const confirm = interaction.options.getString("confirm", true);

      if (confirm.trim().toUpperCase() !== "APPLY") {
        await interaction.reply({
          content: "Confirmation failed. Re-run the command with `confirm` set to `APPLY`.",
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const attachment = interaction.options.getAttachment("plan_file", true);
      const mode = interaction.options.getString("mode", true);
      const plan = await readPlanFromAttachment(attachment);
      const backup = await backupStore.createBackup(interaction.guild, {
        reason: "pre-manual-theme-apply",
        label: attachment.name || "manual-plan",
        mode,
      });

      const report = await themeApplier.apply({
        guild: interaction.guild,
        plan,
        mode,
      });

      await interaction.editReply({
        embeds: [createApplyEmbed({ plan, mode, backup, report })],
      });
      return;
    }

    const concept = interaction.options.getString("concept", true);
    const mode = interaction.options.getString("mode", true);

    if (subcommand === "plan") {
      if (!planner) {
        await interaction.reply({
          content:
            "OpenAI planner is disabled because `OPENAI_API_KEY` is missing. Use `/theme prompt`, then `/theme preview-manual` or `/theme apply-manual` instead.",
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const snapshot = await buildPlannerSnapshot(interaction.guild);
      const plan = await planner.createPlan({
        concept,
        mode,
        snapshot,
      });

      await interaction.editReply({
        embeds: [createPlanEmbed(plan, mode)],
      });
      return;
    }

    if (subcommand === "apply") {
      if (!planner) {
        await interaction.reply({
          content:
            "OpenAI planner is disabled because `OPENAI_API_KEY` is missing. Use `/theme prompt`, then `/theme apply-manual` instead.",
          ephemeral: true,
        });
        return;
      }

      const confirm = interaction.options.getString("confirm", true);

      if (confirm.trim().toUpperCase() !== "APPLY") {
        await interaction.reply({
          content: "Confirmation failed. Re-run the command with `confirm` set to `APPLY`.",
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const backup = await backupStore.createBackup(interaction.guild, {
        reason: "pre-theme-apply",
        label: concept,
        mode,
      });

      const snapshot = await buildPlannerSnapshot(interaction.guild);
      const plan = await planner.createPlan({
        concept,
        mode,
        snapshot,
      });

      const report = await themeApplier.apply({
        guild: interaction.guild,
        plan,
        mode,
      });

      await interaction.editReply({
        embeds: [createApplyEmbed({ plan, mode, backup, report })],
      });
    }
  },
};
