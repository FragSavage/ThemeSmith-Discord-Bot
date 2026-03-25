function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

export class AutoRoleService {
  constructor({ autoRoleName }) {
    this.autoRoleName = autoRoleName;
  }

  findRole(guild) {
    return [...guild.roles.cache.values()].find(
      (role) => role.id !== guild.id && normalizeName(role.name) === normalizeName(this.autoRoleName),
    );
  }

  async assignToMember(member) {
    if (!member || member.user?.bot) {
      return { assigned: false, reason: "skip-bot" };
    }

    if (member.pending) {
      return { assigned: false, reason: "member-pending" };
    }

    const role = this.findRole(member.guild);
    if (!role) {
      return { assigned: false, reason: "role-not-found" };
    }

    if (!role.editable) {
      return { assigned: false, reason: "role-not-editable" };
    }

    if (member.roles.cache.has(role.id)) {
      return { assigned: false, reason: "already-has-role" };
    }

    try {
      await member.roles.add(role, `Auto role assignment: ${role.name}`);
      return { assigned: true, reason: "assigned" };
    } catch {
      return { assigned: false, reason: "member-role-update-forbidden" };
    }
  }

  async assignToExistingMembers(guild) {
    await guild.members.fetch();

    let assignedCount = 0;
    const issues = [];

    for (const member of guild.members.cache.values()) {
      const result = await this.assignToMember(member);

      if (result.assigned) {
        assignedCount += 1;
        continue;
      }

      if (
        result.reason !== "already-has-role" &&
        result.reason !== "skip-bot" &&
        result.reason !== "member-pending"
      ) {
        issues.push(`${member.user?.tag || member.id}: ${result.reason}`);
      }
    }

    return {
      assignedCount,
      issues,
    };
  }
}
