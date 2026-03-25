import OpenAI from "openai";

const knownChannelKinds = new Set([
  "standard",
  "rules",
  "welcome",
  "role-selection",
  "social-feed",
  "admin",
  "announcements",
]);

export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["planSummary", "server", "roles", "categories", "rolloutNotes"],
  properties: {
    planSummary: { type: "string" },
    server: {
      type: "object",
      additionalProperties: false,
      required: ["name", "description", "keywords"],
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        keywords: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    roles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "colorHex", "hoist", "mentionable", "permissions", "purpose", "selfAssignable"],
        properties: {
          name: { type: "string" },
          colorHex: { type: ["string", "null"] },
          hoist: { type: "boolean" },
          mentionable: { type: "boolean" },
          permissions: {
            type: "array",
            items: { type: "string" },
          },
          purpose: { type: "string" },
          selfAssignable: { type: "boolean" },
        },
      },
    },
    categories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "purpose", "channels"],
        properties: {
          name: { type: "string" },
          purpose: { type: "string" },
          channels: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "type", "kind", "topic", "slowmodeSeconds", "purpose", "overwrites"],
              properties: {
                name: { type: "string" },
                type: { type: "string", enum: ["text", "voice"] },
                kind: {
                  type: "string",
                  enum: [
                    "standard",
                    "rules",
                    "welcome",
                    "role-selection",
                    "social-feed",
                    "admin",
                    "announcements",
                  ],
                },
                topic: { type: ["string", "null"] },
                slowmodeSeconds: { type: ["integer", "null"] },
                purpose: { type: "string" },
                overwrites: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["target", "roleName", "allow", "deny"],
                    properties: {
                      target: { type: "string", enum: ["everyone", "role"] },
                      roleName: { type: ["string", "null"] },
                      allow: {
                        type: "array",
                        items: { type: "string" },
                      },
                      deny: {
                        type: "array",
                        items: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    rolloutNotes: {
      type: "array",
      items: { type: "string" },
    },
  },
};

const PLANNER_INSTRUCTIONS = `
You are an expert Discord server architect.

Design a Discord server structure from the user's concept and current server snapshot.

You must output valid JSON that matches the provided schema.

Rules:
- Keep channel names lowercase and hyphenated.
- Only use channel types "text" and "voice".
- Make the server practical, clean, and believable.
- In "scratch" mode, produce a fresh rebuild plan.
- In "existing" mode, adapt and improve the current structure instead of replacing everything.
- Always include a rules channel, a welcome/onboarding channel, a role-selection channel, a social-feed channel, and a private admin channel when the plan is a full server build.
- Do not create harmful, sexual, hateful, illegal, or spam-focused communities.
- Do not assign Administrator to normal community roles.
- Use Discord permission flag names such as ViewChannel, SendMessages, Connect, Speak, ManageMessages.
- Use null for optional fields when they are not needed, especially colorHex, topic, slowmodeSeconds, and roleName.
- Use channel "kind" to tell the bot how to configure the server. Use "rules", "welcome", "role-selection", "social-feed", "admin", "announcements", or "standard".
- Mark optional self-serve identity roles with selfAssignable true. Do not mark default, staff, officer, or verification-gated roles as self-assignable.
- Prefer 3 to 7 categories.
- Prefer 2 to 6 channels per category.
- Keep overwrites simple and useful.
`.trim();

function ensureString(value, label, min = 1) {
  if (typeof value !== "string" || value.trim().length < min) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function ensureBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

function ensureArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value;
}

function normalizeHexColor(value) {
  if (!value) {
    return undefined;
  }

  const trimmed = String(value).trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}

export function validatePlan(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("OpenAI returned an invalid plan payload.");
  }

  const missingFields = [];

  if (typeof raw.planSummary !== "string" || raw.planSummary.trim().length === 0) {
    missingFields.push("planSummary");
  }

  if (!raw.server || typeof raw.server !== "object" || Array.isArray(raw.server)) {
    missingFields.push("server");
  } else {
    if (typeof raw.server.name !== "string" || raw.server.name.trim().length === 0) {
      missingFields.push("server.name");
    }

    if (typeof raw.server.description !== "string" || raw.server.description.trim().length === 0) {
      missingFields.push("server.description");
    }

    if (!Array.isArray(raw.server.keywords)) {
      missingFields.push("server.keywords");
    }
  }

  if (!Array.isArray(raw.roles)) {
    missingFields.push("roles");
  }

  if (!Array.isArray(raw.categories)) {
    missingFields.push("categories");
  }

  if (!Array.isArray(raw.rolloutNotes)) {
    missingFields.push("rolloutNotes");
  }

  if (missingFields.length > 0) {
    const looksLikeThemeBrief =
      typeof raw.theme_overview === "string" ||
      (raw.visual_style && typeof raw.visual_style === "object");

    if (looksLikeThemeBrief) {
      throw new Error(
        `The uploaded file looks like a theme brief, not a full bot plan. Missing required fields: ${missingFields.join(", ")}.`,
      );
    }

    throw new Error(`The uploaded plan is missing required fields: ${missingFields.join(", ")}.`);
  }

  const plan = {
    planSummary: ensureString(raw.planSummary, "planSummary", 10),
    server: {
      name: ensureString(raw.server?.name, "server.name", 2),
      description: ensureString(raw.server?.description, "server.description", 10),
      keywords: ensureArray(raw.server?.keywords, "server.keywords").map((value, index) =>
        ensureString(value, `server.keywords[${index}]`),
      ),
    },
    roles: ensureArray(raw.roles, "roles").map((role, index) => ({
      name: ensureString(role?.name, `roles[${index}].name`, 2),
      colorHex: normalizeHexColor(role?.colorHex),
      hoist: ensureBoolean(role?.hoist, `roles[${index}].hoist`),
      mentionable: ensureBoolean(role?.mentionable, `roles[${index}].mentionable`),
      selfAssignable: typeof role?.selfAssignable === "boolean" ? role.selfAssignable : false,
      permissions: ensureArray(role?.permissions, `roles[${index}].permissions`).map((permission, permissionIndex) =>
        ensureString(permission, `roles[${index}].permissions[${permissionIndex}]`),
      ),
      purpose: ensureString(role?.purpose, `roles[${index}].purpose`, 4),
    })),
    categories: ensureArray(raw.categories, "categories").map((category, categoryIndex) => ({
      name: ensureString(category?.name, `categories[${categoryIndex}].name`, 2),
      purpose: ensureString(category?.purpose, `categories[${categoryIndex}].purpose`, 4),
      channels: ensureArray(category?.channels, `categories[${categoryIndex}].channels`).map(
        (channel, channelIndex) => {
          const channelType = ensureString(
            channel?.type,
            `categories[${categoryIndex}].channels[${channelIndex}].type`,
            4,
          );

          if (channelType !== "text" && channelType !== "voice") {
            throw new Error(
              `categories[${categoryIndex}].channels[${channelIndex}].type must be text or voice.`,
            );
          }

          const channelKind =
            typeof channel?.kind === "string" && channel.kind.trim().length > 0
              ? ensureString(channel.kind, `categories[${categoryIndex}].channels[${channelIndex}].kind`)
              : "standard";

          if (!knownChannelKinds.has(channelKind)) {
            throw new Error(
              `categories[${categoryIndex}].channels[${channelIndex}].kind must be one of: ${[...knownChannelKinds].join(", ")}.`,
            );
          }

          return {
            name: ensureString(
              channel?.name,
              `categories[${categoryIndex}].channels[${channelIndex}].name`,
              2,
            ),
            type: channelType,
            kind: channelKind,
            topic: channel?.topic
              ? ensureString(channel.topic, `categories[${categoryIndex}].channels[${channelIndex}].topic`)
              : undefined,
            slowmodeSeconds:
              typeof channel?.slowmodeSeconds === "number" && Number.isInteger(channel.slowmodeSeconds)
                ? Math.max(0, Math.min(channel.slowmodeSeconds, 21600))
                : undefined,
            purpose: ensureString(
              channel?.purpose,
              `categories[${categoryIndex}].channels[${channelIndex}].purpose`,
              4,
            ),
            overwrites: ensureArray(
              channel?.overwrites,
              `categories[${categoryIndex}].channels[${channelIndex}].overwrites`,
            ).map((overwrite, overwriteIndex) => {
              const target = ensureString(
                overwrite?.target,
                `categories[${categoryIndex}].channels[${channelIndex}].overwrites[${overwriteIndex}].target`,
              );

              if (target !== "everyone" && target !== "role") {
                throw new Error(
                  `categories[${categoryIndex}].channels[${channelIndex}].overwrites[${overwriteIndex}].target must be everyone or role.`,
                );
              }

              return {
                target,
                roleName:
                  overwrite?.roleName == null
                    ? undefined
                    : ensureString(
                        overwrite.roleName,
                        `categories[${categoryIndex}].channels[${channelIndex}].overwrites[${overwriteIndex}].roleName`,
                        2,
                      ),
                allow: ensureArray(
                  overwrite?.allow,
                  `categories[${categoryIndex}].channels[${channelIndex}].overwrites[${overwriteIndex}].allow`,
                ).map((permission, permissionIndex) =>
                  ensureString(
                    permission,
                    `categories[${categoryIndex}].channels[${channelIndex}].overwrites[${overwriteIndex}].allow[${permissionIndex}]`,
                  ),
                ),
                deny: ensureArray(
                  overwrite?.deny,
                  `categories[${categoryIndex}].channels[${channelIndex}].overwrites[${overwriteIndex}].deny`,
                ).map((permission, permissionIndex) =>
                  ensureString(
                    permission,
                    `categories[${categoryIndex}].channels[${channelIndex}].overwrites[${overwriteIndex}].deny[${permissionIndex}]`,
                  ),
                ),
              };
            }),
          };
        },
      ),
    })),
    rolloutNotes: ensureArray(raw.rolloutNotes, "rolloutNotes").map((value, index) =>
      ensureString(value, `rolloutNotes[${index}]`, 4),
    ),
  };

  return plan;
}

export function buildPlannerPrompt({ concept, mode, snapshot }) {
  return [
    "You are creating a Discord server theme plan.",
    "Return JSON only.",
    "",
    `Mode: ${mode}`,
    `Theme request: ${concept}`,
    "",
    "Current Discord server snapshot:",
    JSON.stringify(snapshot, null, 2),
    "",
    "Build a complete plan with a coherent identity, useful community roles, and practical channel structure.",
    "Use null for optional fields when not needed.",
    "",
    "JSON shape reminder:",
    JSON.stringify(
      {
        planSummary: "string",
        server: {
          name: "string",
          description: "string",
          keywords: ["string"],
        },
        roles: [
          {
            name: "string",
            colorHex: "#5865F2 or null",
            hoist: true,
            mentionable: false,
            selfAssignable: false,
            permissions: ["ViewChannel"],
            purpose: "string",
          },
        ],
        categories: [
          {
            name: "string",
            purpose: "string",
            channels: [
              {
                name: "string",
                type: "text or voice",
                kind: "rules, welcome, role-selection, social-feed, admin, announcements, or standard",
                topic: "string or null",
                slowmodeSeconds: 0,
                purpose: "string",
                overwrites: [
                  {
                    target: "everyone or role",
                    roleName: "string or null",
                    allow: ["ViewChannel"],
                    deny: ["SendMessages"],
                  },
                ],
              },
            ],
          },
        ],
        rolloutNotes: ["string"],
      },
      null,
      2,
    ),
  ].join("\n");
}

export class OpenAiThemePlanner {
  constructor({ apiKey, model }) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async createPlan({ concept, mode, snapshot }) {
    const response = await this.client.responses.create({
      model: this.model,
      instructions: PLANNER_INSTRUCTIONS,
      input: buildPlannerPrompt({ concept, mode, snapshot }),
      text: {
        format: {
          type: "json_schema",
          name: "discord_theme_plan",
          strict: true,
          schema: PLAN_SCHEMA,
        },
      },
    });

    const rawText = response.output_text?.trim();
    if (!rawText) {
      throw new Error("OpenAI returned an empty response.");
    }

    return validatePlan(JSON.parse(rawText));
  }
}
