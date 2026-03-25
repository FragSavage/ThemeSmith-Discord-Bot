import {
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  PermissionsBitField,
} from "discord.js";
import { loadConfig } from "./config.js";
import { themeCommand } from "./theme-command.js";
import { AutoRoleService } from "./auto-role-service.js";
import { BackupStore } from "./backup-store.js";
import { CreatorCreditService } from "./creator-credit-service.js";
import { OpenAiThemePlanner } from "./openai-theme-planner.js";
import { RoleSelectionService } from "./role-selection-service.js";
import { ThemeApplier } from "./theme-applier.js";

const config = loadConfig();

const planner = config.openAiApiKey
  ? new OpenAiThemePlanner({
      apiKey: config.openAiApiKey,
      model: config.openAiModel,
    })
  : null;

const backupStore = new BackupStore({
  backupDirectory: config.backupDirectory,
});

const autoRoleService = new AutoRoleService({
  autoRoleName: config.autoRoleName,
});

const roleSelectionService = new RoleSelectionService({
  defaultRoleName: config.autoRoleName,
});

const creatorCreditService = new CreatorCreditService({
  enabled: config.creatorCreditEnabled,
  message: config.creatorCreditText,
});

const themeApplier = new ThemeApplier({
  archiveCategoryName: config.archiveCategoryName,
  allowServerRename: config.allowServerRename,
  scratchDeleteUnmatched: config.scratchDeleteUnmatched,
  autoRoleService,
  roleSelectionService,
});

const client = new Client({
  intents: config.enableMemberEvents
    ? [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
    : [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, async (readyClient) => {
  await backupStore.ensureReady();

  console.log(`[theme-bot] Logged in as ${readyClient.user.tag}`);
  console.log(
    `[theme-bot] OpenAI planner: ${planner ? `enabled (${config.openAiModel})` : "disabled; manual mode available"}`,
  );
  console.log(`[theme-bot] Archive category: ${config.archiveCategoryName}`);
  console.log(`[theme-bot] Auto role: ${config.autoRoleName}`);
  console.log(`[theme-bot] Scratch delete unmatched: ${config.scratchDeleteUnmatched ? "enabled" : "disabled"}`);
  console.log(`[theme-bot] Member events: ${config.enableMemberEvents ? "enabled" : "disabled"}`);

  const inviteUrl = new URL("https://discord.com/oauth2/authorize");
  inviteUrl.searchParams.set("client_id", config.discordClientId);
  inviteUrl.searchParams.set("scope", "bot applications.commands");
  inviteUrl.searchParams.set(
    "permissions",
    new PermissionsBitField(PermissionFlagsBits.Administrator).bitfield.toString(),
  );

  console.log(`[theme-bot] Admin invite URL: ${inviteUrl.toString()}`);
});

if (config.enableMemberEvents) {
  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      await autoRoleService.assignToMember(member);
    } catch (error) {
      console.error("[theme-bot] Auto role assignment failed on member join", error);
    }
  });

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    if (oldMember.pending && !newMember.pending) {
      try {
        await autoRoleService.assignToMember(newMember);
      } catch (error) {
        console.error("[theme-bot] Auto role assignment failed on member update", error);
      }
    }
  });
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isStringSelectMenu()) {
    try {
      const handled = await roleSelectionService.handleInteraction(interaction);
      if (handled) {
        return;
      }
    } catch (error) {
      console.error("[theme-bot] Role selection interaction failed", error);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: "Role selection failed. Please try again." }).catch(() => null);
      } else {
        await interaction.reply({
          content: "Role selection failed. Please try again.",
          ephemeral: true,
        }).catch(() => null);
      }

      return;
    }
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (interaction.commandName !== themeCommand.data.name) {
    return;
  }

  try {
    await themeCommand.execute(interaction, {
      planner,
      backupStore,
      themeApplier,
    });

    creatorCreditService.announceInRandomChannel(interaction.guild).catch((error) => {
      console.error("[theme-bot] Creator credit announcement failed", error);
    });
  } catch (error) {
    console.error("[theme-bot] Command failed", error);

    const message =
      error instanceof Error
        ? `The command failed: ${error.message}`
        : "The command failed because of an unexpected error.";

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message });
      return;
    }

    await interaction.reply({ content: message, ephemeral: true });
  }
});

client.login(config.discordToken).catch((error) => {
  console.error("[theme-bot] Failed to log in.");
  console.error(error);
  process.exitCode = 1;
});
