import "dotenv/config";
import path from "node:path";

function readRequired(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readOptional(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function readBoolean(name, fallback) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }

  return value === "true" || value === "1" || value === "yes";
}

export function loadConfig() {
  return {
    discordToken: readRequired("DISCORD_TOKEN"),
    discordClientId: readRequired("DISCORD_CLIENT_ID"),
    discordGuildId: readOptional("DISCORD_GUILD_ID"),
    openAiApiKey: readOptional("OPENAI_API_KEY"),
    openAiModel: readOptional("OPENAI_MODEL") || "gpt-5.4",
    archiveCategoryName: readOptional("ARCHIVE_CATEGORY_NAME") || "archive",
    allowServerRename: readBoolean("ALLOW_SERVER_RENAME", true),
    autoRoleName: readOptional("AUTO_ROLE_NAME") || "Member",
    scratchDeleteUnmatched: readBoolean("SCRATCH_DELETE_UNMATCHED", true),
    enableMemberEvents: readBoolean("ENABLE_MEMBER_EVENTS", false),
    creatorCreditEnabled: readBoolean("CREATOR_CREDIT_ENABLED", true),
    creatorCreditText: readOptional("CREATOR_CREDIT_TEXT") || "Created by @FragSavage",
    backupDirectory: path.resolve("backups"),
  };
}
