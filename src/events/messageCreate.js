import { Events } from 'discord.js';
import { handleDirectMessage } from '../handlers/directMessage.js';
import { handlePrefixCommand } from '../handlers/prefixCommand.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot) return;
    if (message.inGuild()) {
      await handlePrefixCommand(message);
      return;
    }
    await handleDirectMessage(message);
  },
};
