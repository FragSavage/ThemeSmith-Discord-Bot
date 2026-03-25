@echo off
setlocal
title ThemeSmith Easy Setup
color 0A

echo.
echo ==========================================
echo         ThemeSmith Easy Setup
echo ==========================================
echo.
echo This file will:
echo 1. Check that Node.js is installed
echo 2. Create the folders the bot needs later
echo 3. Create your .env file if you do not have one
echo 4. Install the bot packages
echo 5. Deploy the Discord slash commands
echo 6. Offer to start the bot
echo.

where node >nul 2>nul
if errorlevel 1 goto no_node

where npm >nul 2>nul
if errorlevel 1 (
  where npm.cmd >nul 2>nul
  if errorlevel 1 goto no_node
)

if not exist backups mkdir backups

if not exist .env (
  copy /Y .env.example .env >nul
  echo Created .env from .env.example
  echo.
)

findstr /C:"your_discord_bot_token" .env >nul 2>nul
if not errorlevel 1 goto edit_env

findstr /C:"your_discord_application_client_id" .env >nul 2>nul
if not errorlevel 1 goto edit_env

goto install_packages

:edit_env
echo ==========================================
echo              IMPORTANT
echo ==========================================
echo.
echo Your .env file still has placeholder values.
echo A text file will open now.
echo.
echo Replace these with your real values:
echo - DISCORD_TOKEN
echo - DISCORD_CLIENT_ID
echo - DISCORD_GUILD_ID  (optional but recommended for testing)
echo - OPENAI_API_KEY    (optional)
echo.
echo Save the file, then close Notepad.
echo.
notepad .env
echo.
echo Press any key after you have saved and closed .env
pause >nul

findstr /C:"your_discord_bot_token" .env >nul 2>nul
if not errorlevel 1 (
  echo.
  echo .env still has placeholder values.
  echo Setup has stopped so you can fix that first.
  echo.
  pause
  exit /b 1
)

findstr /C:"your_discord_application_client_id" .env >nul 2>nul
if not errorlevel 1 (
  echo.
  echo .env still has placeholder values.
  echo Setup has stopped so you can fix that first.
  echo.
  pause
  exit /b 1
)

:install_packages
echo.
echo ==========================================
echo        Installing bot packages...
echo ==========================================
echo.
call npm.cmd install
if errorlevel 1 goto install_failed

echo.
echo ==========================================
echo      Deploying Discord commands...
echo ==========================================
echo.
call npm.cmd run deploy
if errorlevel 1 goto deploy_failed

echo.
echo ==========================================
echo            Setup Complete
echo ==========================================
echo.
echo Your bot is ready.
echo.
choice /M "Do you want to start the bot now"
if errorlevel 2 goto done

echo.
call start-bot.bat
exit /b %errorlevel%

:no_node
echo.
echo Node.js is not installed.
echo Please install the Windows x64 LTS version from:
echo https://nodejs.org/
echo.
pause
exit /b 1

:install_failed
echo.
echo npm install failed.
echo Please fix the error above, then run easy-setup.bat again.
echo.
pause
exit /b 1

:deploy_failed
echo.
echo Command deployment failed.
echo Check your .env values, then run easy-setup.bat again.
echo.
pause
exit /b 1

:done
echo.
echo Setup is finished.
echo When you want to run the bot later, double-click start-bot.bat
echo.
pause
exit /b 0
