# BillyBot

A Discord music bot ("BillyTube") that plays YouTube links in a voice channel. Built with [discord.js](https://discord.js.org) v14 and [@discordjs/voice](https://discord.js.org/docs/packages/voice/main) on Node.js 24. Songs are streamed with [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [ffmpeg](https://ffmpeg.org); nothing is saved to disk.

## Commands

Commands start with the prefix (`!` by default) and must be typed exactly, e.g. `!play`, not `!Play` or `!playlist`.

| Command                | What it does                                                                                                                                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `!play <YouTube link>` | Shows a "🔎 Searching…" card right away, then joins your voice channel and plays the song (the card becomes Now Playing), or adds it to the queue (the card becomes Added to Queue). Only in the `music_bot` channel, for members with the `DJ` role who are in a voice channel. |
| `!skip`                | Skips to the next song in the queue.                                                                                                                                                                                                                                             |
| `!queue`               | Shows the song playing and how far into it, then the next 10 songs and how many are queued.                                                                                                                                                                                      |
| `!leave`               | Leaves the voice channel and clears the queue.                                                                                                                                                                                                                                   |
| `!help`                | DMs you the list of commands.                                                                                                                                                                                                                                                    |
| `!patchnotes`          | Posts the latest patch notes.                                                                                                                                                                                                                                                    |

- The bot leaves by itself when nobody else is left in its voice channel.
- YouTube video links work in any common form (`youtube.com/watch`, `youtu.be`, Shorts, YouTube Music). Playlist and channel links do not.
- Spotify links are no longer supported (since 3.1); the bot says so.
- DMs to the bot: `help` and `patchnotes` work there too, plus the easter eggs.

## Development

Requires Node.js 24 (see `.nvmrc`), yt-dlp and ffmpeg on `PATH`.

```bash
npm install
cp .env.example .env        # fill in DISCORD_TOKEN
npm run dev                 # start with auto-restart and readable logs
```

There is no separate test bot: testing uses the production token in a test server. **Stop the production service first** (`sudo systemctl stop billybot` on the server), or both copies answer every command. Start it again when you are done.

For easter eggs while testing, create `easter-eggs.json` (git-ignored) following `easter-eggs.example.json`.

### Scripts

| Script                 | What it does                              |
| ---------------------- | ----------------------------------------- |
| `npm start`            | Run the bot (production; plain JSON logs) |
| `npm run dev`          | Run with auto-restart and readable logs   |
| `npm test`             | Run the tests once                        |
| `npm run test:watch`   | Rerun the tests on every change           |
| `npm run lint`         | Check the code with ESLint                |
| `npm run format`       | Format everything with Prettier           |
| `npm run format:check` | Check formatting without changing files   |

### Project structure

```
src/
  index.js          startup and shutdown
  client.js         Discord client and intents
  config.js         .env and easter-eggs.json, checked with zod
  commands/         one file per prefix command
  events/           Discord event handlers (messages, voice state, ready, errors)
  handlers/         prefix command dispatch, DM replies
  loaders/          load commands/ and events/ at startup
  music/            per-server player and queue, link parsing, yt-dlp/ffmpeg, embeds
  lib/              logger, reply texts, safe send, duration formatting
tests/              Vitest tests, with fakes for Discord, voice and child processes
deploy/             systemd service and logrotate templates
docs/               deployment guide
```

To add a command, add a file under `src/commands/` that default-exports `{ name, execute(message, args) }`; it is loaded automatically. Put any text it sends in `src/lib/replies.js` and send with `send()` from `src/lib/send.js`, which logs instead of crashing when Discord refuses a message.

## Deployment

See [docs/deployment.md](docs/deployment.md): installing Node, yt-dlp and ffmpeg, the systemd service, configuration, logs and updating.
