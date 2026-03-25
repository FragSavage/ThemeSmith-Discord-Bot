# ThemeSmith Discord Bot

ThemeSmith is a Discord bot that can rebuild a server from scratch or improve an existing one using an AI-generated or manually uploaded plan.

## Super Easy Setup

1. Download the bot files.
2. Double-click `easy-setup.bat`.
3. If a text file opens, paste your real Discord bot info into `.env`, then save and close it.
4. Wait for setup to finish.
5. If asked, let it start the bot for you.
6. If you ever want to run the bot again later, double-click `start-bot.bat`.

That is the easiest path.

## What The Bot Can Do

- create a server theme plan
- preview a theme plan before applying it
- rebuild a server in `scratch` mode
- improve a server in `existing` mode
- set up rules, welcome, role-selection, social, and admin channels
- auto-assign a default role
- accept `.json` or `.txt` plan files
- back up the current server before changes

## Files Included

- `easy-setup.bat`
- `start-bot.bat`
- `.env.example`
- `README.md`
- `LICENSE`
- `package.json`
- `package-lock.json`
- `index.js`
- `deploy-commands.js`
- `config.js`
- `theme-command.js`
- `guild-snapshot.js`
- `backup-store.js`
- `openai-theme-planner.js`
- `theme-applier.js`
- `auto-role-service.js`
- `role-selection-service.js`
- `creator-credit-service.js`
- `example-community-plan.json`
- `example-community-plan.txt`

## Manual Plan Files

ThemeSmith accepts:

- `.json` files containing a valid plan
- `.txt` files containing a valid JSON plan
- `.txt` files where the JSON is wrapped in ```json fences

Starter files:

- `example-community-plan.json`
- `example-community-plan.txt`

## Slash Commands

- `/theme prompt`
- `/theme plan`
- `/theme preview-manual`
- `/theme apply`
- `/theme apply-manual`
- `/theme backup`
- `/theme backups`

## Environment Values

If `easy-setup.bat` opens `.env`, these are the most important values:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID`
- `OPENAI_API_KEY`

Default values already included:

```env
OPENAI_MODEL=gpt-5.4
ARCHIVE_CATEGORY_NAME=archive
ALLOW_SERVER_RENAME=true
AUTO_ROLE_NAME=Member
SCRATCH_DELETE_UNMATCHED=true
ENABLE_MEMBER_EVENTS=false
CREATOR_CREDIT_ENABLED=true
CREATOR_CREDIT_TEXT=Created by @FragSavage
```

## Important Notes

- This bot should only be used in servers you own or fully control.
- The bot role must sit above the roles it needs to edit, delete, or assign.
- In `scratch` mode, unmatched channels, categories, and removable roles are deleted by default.
- After somebody downloads this project and runs setup, the bot will create the folders it needs automatically.
