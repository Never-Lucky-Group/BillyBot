import { logger } from '../lib/logger.js';

// Runs the command in a server message such as "!play <link>". The command name must follow the
// prefix directly and match exactly, so "!playlist" or "! play" run nothing. Messages that are not
// commands are ignored.
export async function handlePrefixCommand(message) {
  const { commands, settings } = message.client;
  if (!message.content.startsWith(settings.prefix)) return;

  const [name, ...args] = message.content
    .slice(settings.prefix.length)
    .split(/\s+/)
    .filter((word, index) => index === 0 || word !== '');
  const command = commands.get(name);
  if (!command) return;

  logger.info(
    { command: name, guildId: message.guild.id, userId: message.author.id },
    'Running command',
  );
  await command.execute(message, args);
}
