import { Events } from 'discord.js';
import { logger } from '../lib/logger.js';

export default {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    logger.info(
      {
        user: client.user.tag,
        guilds: client.guilds.cache.map((guild) => ({ id: guild.id, name: guild.name })),
      },
      'Logged in to Discord',
    );
  },
};
