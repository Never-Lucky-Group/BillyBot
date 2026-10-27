import { setTimeout as sleep } from 'node:timers/promises';
import packageJson from '../package.json' with { type: 'json' };
import { createClient } from './client.js';
import { ConfigError, loadEasterEggs, loadEnv } from './config.js';
import { logger } from './lib/logger.js';
import { loadCommands } from './loaders/commands.js';
import { loadEvents } from './loaders/events.js';
import { createMedia } from './music/media.js';
import { PlayerRegistry } from './music/players.js';
import { SettingsStore } from './settings/store.js';

async function main() {
  const env = loadEnv();
  logger.level = env.logLevel;

  const client = createClient();
  // Attached to the client so commands and event handlers can reach them via message.client.
  client.settings = { prefix: env.prefix };
  client.easterEggs = await loadEasterEggs(env.easterEggsPath);
  // Each server's music channel and DJ role, from !setup.
  client.settingsStore = await SettingsStore.load(env.settingsPath);
  client.commands = await loadCommands();
  client.media = createMedia({ ytdlpPath: env.ytdlpPath, ffmpegPath: env.ffmpegPath });
  client.players = new PlayerRegistry({ media: client.media });
  const eventCount = await loadEvents(client);

  if (!client.easterEggs) {
    logger.info({ path: env.easterEggsPath }, 'No easter eggs file; easter eggs are off');
  }
  logger.info(
    {
      version: packageJson.version,
      prefix: env.prefix,
      commands: client.commands.size,
      events: eventCount,
      easterEggs: client.easterEggs?.size ?? 0,
      serversWithSetup: client.settingsStore.size,
    },
    'Starting bot',
  );
  await client.media.checkTools();

  registerShutdownHandlers(client);
  await client.login(env.token);
}

// How long the "leave voice" messages get to reach Discord before the bot disconnects. They are
// sent asynchronously, and disconnecting straight away can drop them.
const LEAVE_VOICE_WAIT_MS = 1_000;

// systemd stops the service with SIGTERM. Leaving voice first means the bot does not linger in a
// channel until Discord notices it is gone.
function registerShutdownHandlers(client) {
  const shutdown = (signal) => {
    logger.info({ signal }, 'Shutting down');
    const left = client.players.destroyAll();
    void (left > 0 ? sleep(LEAVE_VOICE_WAIT_MS) : Promise.resolve())
      .then(() => client.destroy())
      .finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

try {
  await main();
} catch (error) {
  if (error instanceof ConfigError) {
    logger.fatal(error.message);
  } else {
    logger.fatal({ err: error }, 'Failed to start the bot');
  }
  process.exit(1);
}
