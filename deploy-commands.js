import { REST, Routes } from "discord.js";
import { loadConfig } from "./config.js";
import { themeCommand } from "./theme-command.js";

async function main() {
  const config = loadConfig();
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const commands = [themeCommand.data.toJSON()];

  if (config.discordGuildId) {
    await rest.put(
      Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
      { body: commands },
    );
    console.log(`Registered ${commands.length} guild command(s) to ${config.discordGuildId}.`);
    return;
  }

  await rest.put(Routes.applicationCommands(config.discordClientId), {
    body: commands,
  });
  console.log(`Registered ${commands.length} global command(s).`);
}

main().catch((error) => {
  console.error("Failed to deploy slash commands.");
  console.error(error);
  process.exitCode = 1;
});
