import fs from "node:fs/promises";
import path from "node:path";
import { buildBackupSnapshot } from "./guild-snapshot.js";

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "backup";
}

export class BackupStore {
  constructor({ backupDirectory }) {
    this.backupDirectory = backupDirectory;
  }

  async ensureReady() {
    await fs.mkdir(this.backupDirectory, { recursive: true });
  }

  async createBackup(guild, metadata = {}) {
    await this.ensureReady();

    const snapshot = await buildBackupSnapshot(guild, metadata);
    const timestamp = snapshot.createdAt.replace(/[:.]/g, "-");
    const label = slugify(metadata.label || metadata.reason || guild.name);
    const fileName = `${guild.id}-${timestamp}-${label}.json`;
    const filePath = path.join(this.backupDirectory, fileName);

    await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf8");

    return {
      fileName,
      filePath,
      createdAt: snapshot.createdAt,
      snapshot,
    };
  }

  async listBackups(guildId, limit = 10) {
    await this.ensureReady();

    const files = await fs.readdir(this.backupDirectory);
    const matchingFiles = files
      .filter((file) => file.startsWith(`${guildId}-`) && file.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, limit);

    const backups = [];

    for (const fileName of matchingFiles) {
      const filePath = path.join(this.backupDirectory, fileName);
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);

      backups.push({
        fileName,
        filePath,
        createdAt: parsed.createdAt || null,
        reason: parsed.metadata?.reason || parsed.metadata?.label || "manual backup",
        guildName: parsed.guild?.name || null,
      });
    }

    return backups;
  }
}
