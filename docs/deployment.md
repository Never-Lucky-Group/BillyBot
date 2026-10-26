# Deployment

How to run BillyBot in production: a Linux machine (the bot runs on Linux Mint) with the bot as a systemd service, which restarts it if it crashes and starts it on boot. For working on the code, see the [README](../README.md).

## Requirements

| Program    | Why                                   | Check              |
| ---------- | ------------------------------------- | ------------------ |
| Node.js 24 | Runs the bot                          | `node --version`   |
| yt-dlp     | Looks up and downloads YouTube audio  | `yt-dlp --version` |
| ffmpeg     | Converts the audio for Discord (Opus) | `ffmpeg -version`  |

### Node.js 24

Linux Mint's own Node package is too old. Install Node 24 from NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # v24.x
which node       # /usr/bin/node, used in the service file
```

### ffmpeg

```bash
sudo apt install -y ffmpeg
```

### yt-dlp

Use the official release binary, not the apt package (it is too old for YouTube). It includes `yt-dlp-ejs`, which YouTube needs, and uses the bot's Node.js to run it.

```bash
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
yt-dlp --version
```

YouTube changes often, and an old yt-dlp is the most common reason songs stop playing (`Failed to download audio.`). Update it first when that happens:

```bash
sudo yt-dlp -U
```

## Discord application

In the [Discord Developer Portal](https://discord.com/developers/applications), on the bot's **Bot** tab, **Message Content Intent** must be on: the prefix commands need it. The bot no longer uses **Server Members Intent** or **Presence Intent**, so you can turn those off.

The bot needs these permissions in servers: View Channels, Send Messages, Embed Links, Connect and Speak.

## First install, or moving from before 3.1

The repository's history was rewritten for 3.1, so an existing checkout cannot `git pull`. Move it aside and clone again. Run these as the user that runs the bot.

1. Stop and disable the old service. Find its name with `systemctl list-units --all | grep -i billy`:

   ```bash
   sudo systemctl disable --now OLD_SERVICE_NAME
   ```

2. Move the old checkout aside, and clone:

   ```bash
   mv ~/BillyBot ~/BillyBot-old
   git clone https://github.com/Never-Lucky-Group/BillyBot.git ~/BillyBot
   cd ~/BillyBot
   npm ci --omit=dev
   ```

3. Create `.env` from `.env.example`. Before 3.1 the token and prefix were in `config.json`; copy them over:

   ```bash
   cp .env.example .env
   chmod 600 .env
   nano .env   # DISCORD_TOKEN = "token" from the old config.json; PREFIX = its "prefix"
   ```

4. Copy `easter-eggs.json` into the folder (it is not in the repository; see `easter-eggs.example.json` for the format). Without it, the bot runs with easter eggs off.

5. Install the service. Edit the copy and replace `YOUR_USER`, `/path/to/BillyBot` and, if `which node` printed something else, `/usr/bin/node`:

   ```bash
   sudo cp deploy/billybot.service /etc/systemd/system/billybot.service
   sudo nano /etc/systemd/system/billybot.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now billybot
   ```

6. Check the logs (below). Startup should show `Found yt-dlp`, `Found ffmpeg` and `Logged in to Discord`, with no errors.

7. Once the bot works, delete the old checkout. It holds the old `config.json`, `spotify_config.json`, token file and `songs/` folder, none of which 3.1 uses:

   ```bash
   rm -rf ~/BillyBot-old
   ```

## Configuration

Settings are environment variables in `.env`, checked when the bot starts. An invalid value stops the bot with a message saying what is wrong.

| Variable           | Default            | Meaning                                                   |
| ------------------ | ------------------ | --------------------------------------------------------- |
| `DISCORD_TOKEN`    | (required)         | The bot token (Developer Portal → Bot → Reset Token)      |
| `PREFIX`           | `!`                | What every command starts with                            |
| `LOG_LEVEL`        | `info`             | `fatal`, `error`, `warn`, `info`, `debug` or `trace`      |
| `EASTER_EGGS_PATH` | `easter-eggs.json` | The easter-egg DM replies; easter eggs are off if missing |
| `YTDLP_PATH`       | `yt-dlp`           | The yt-dlp program, if it is not on the service's `PATH`  |
| `FFMPEG_PATH`      | `ffmpeg`           | The ffmpeg program, if it is not on the service's `PATH`  |

Restart the service after changing `.env` or `easter-eggs.json`.

## Running the service

```bash
sudo systemctl status billybot     # running? last few log lines
sudo systemctl restart billybot
sudo systemctl stop billybot       # also before testing locally with the same token
sudo systemctl start billybot
```

### Logs

The bot logs JSON lines to the journal. To read them:

```bash
journalctl -u billybot -f                         # follow, raw JSON
journalctl -u billybot -f -o cat | npx pino-pretty # follow, readable
journalctl -u billybot --since "1 hour ago" -o cat | npx pino-pretty
```

Set `LOG_LEVEL=debug` in `.env` to also log voice connection changes and broken pipes between yt-dlp and ffmpeg.

## Updating

```bash
cd ~/BillyBot
git pull
npm ci --omit=dev
sudo systemctl restart billybot
```

When songs stop playing, check in this order:

1. `sudo yt-dlp -U`, then try again. No restart is needed: the bot runs yt-dlp fresh for every song.
2. The logs, for the error yt-dlp or ffmpeg printed.
3. Updating the bot's packages (`npm update` on a development machine, test, then deploy).
