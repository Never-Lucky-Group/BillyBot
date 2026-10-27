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

4. Copy `easter-eggs.json` into the folder (it is not in the repository; see `easter-eggs.example.json` for the format). Without it, the bot runs with easter eggs off. When moving an existing install, also copy `data/settings.json` if it exists: it holds each server's `!setup` choices.

5. Install the service. Edit the copy and replace `YOUR_USER`, `/path/to/BillyBot` and, if `which node` printed something else, `/usr/bin/node`:

   ```bash
   sudo cp deploy/billybot.service /etc/systemd/system/billybot.service
   sudo nano /etc/systemd/system/billybot.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now billybot
   ```

   Then install the log rotation rule (see [Logs](#logs)). Replace `YOUR_USER` and `/path/to/BillyBot` the same way:

   ```bash
   sudo cp deploy/billybot.logrotate /etc/logrotate.d/billybot
   sudo nano /etc/logrotate.d/billybot
   sudo logrotate --debug /etc/logrotate.d/billybot   # checks the rule; changes nothing
   ```

   The check should end with `log does not need rotating` and no `error:` lines.

6. Check the logs (below). Startup should show `Found yt-dlp`, `Found ffmpeg` and `Logged in to Discord`, with no errors.

7. Once the bot works, delete the old checkout. It holds the old `config.json`, `spotify_config.json`, token file and `songs/` folder, none of which 3.1 uses:

   ```bash
   rm -rf ~/BillyBot-old
   ```

## Configuration

Settings are environment variables in `.env`, checked when the bot starts. An invalid value stops the bot with a message saying what is wrong.

| Variable           | Default              | Meaning                                                       |
| ------------------ | -------------------- | ------------------------------------------------------------- |
| `DISCORD_TOKEN`    | (required)           | The bot token (Developer Portal → Bot → Reset Token)          |
| `PREFIX`           | `!`                  | What every command starts with                                |
| `LOG_LEVEL`        | `info`               | `fatal`, `error`, `warn`, `info`, `debug` or `trace`          |
| `EASTER_EGGS_PATH` | `easter-eggs.json`   | The easter-egg DM replies; easter eggs are off if missing     |
| `SETTINGS_PATH`    | `data/settings.json` | Each server's `!setup` choices; created by the first `!setup` |
| `YTDLP_PATH`       | `yt-dlp`             | The yt-dlp program, if it is not on the service's `PATH`      |
| `FFMPEG_PATH`      | `ffmpeg`             | The ffmpeg program, if it is not on the service's `PATH`      |

Restart the service after changing `.env` or `easter-eggs.json`.

### Server settings (`!setup`)

Each server's music channel and DJ role, chosen in Discord with `!setup`, are saved in `data/settings.json` in the bot's folder (or `SETTINGS_PATH`). Servers that never ran `!setup` are not in it and use the defaults: a channel named `music_bot` and a role named `DJ`. The bot writes the file itself and never needs a restart for a change. It is not in git, so `git pull` keeps it, but a fresh clone does not: copy it across, and keep a backup if the settings matter. If the file is ever invalid, the bot refuses to start (rather than overwrite it) and says why in the log; fix or delete it, and deleted servers go back to the defaults.

## Running the service

```bash
sudo systemctl status billybot     # running? when it last started or crashed
sudo systemctl restart billybot
sudo systemctl stop billybot       # also before testing locally with the same token
sudo systemctl start billybot
```

### Logs

The bot writes its logs as JSON lines to `billybot.log` in its folder. systemd's own messages about the service (started, stopped, crashed and restarted) are in the journal. To read them:

```bash
tail -F ~/BillyBot/billybot.log | npx --yes pino-pretty      # follow, readable
npx --yes pino-pretty < ~/BillyBot/billybot.log | less -R    # the whole current log
zcat ~/BillyBot/billybot.log.1.gz | npx --yes pino-pretty    # the previous log
journalctl -u billybot                                       # starts, stops, crashes
```

`pino-pretty` is not installed on the server (`npm ci --omit=dev` leaves it out), so `npx --yes` downloads it the first time.

Set `LOG_LEVEL=debug` in `.env` to also log voice connection changes and broken pipes between yt-dlp and ffmpeg.

#### Log rotation

`/etc/logrotate.d/billybot` (from `deploy/billybot.logrotate`) stops the log from filling the disk. logrotate runs once a day; when `billybot.log` is over 10 MB, it is compressed into `billybot.log.1.gz` and emptied, and older logs move up (`.2.gz`, …). Only the newest 5 are kept, so the logs take around 20 MB at most. A few lines written at the moment of rotation can be lost; that is the cost of rotating a file the bot keeps open.

```bash
ls -lh ~/BillyBot/billybot.log*                         # current size, rotated logs
sudo logrotate --debug /etc/logrotate.d/billybot        # what logrotate would do now
sudo logrotate --force /etc/logrotate.d/billybot        # rotate now, e.g. to try it out
```

To change the size or how many logs are kept, edit `size` and `rotate` in `/etc/logrotate.d/billybot`. The next daily run picks it up.

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
