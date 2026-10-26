import { helpText } from '../lib/replies.js';
import { send } from '../lib/send.js';

// Answers by DM.
export default {
  name: 'help',
  async execute(message) {
    await send(message.author, helpText(message.client.settings.prefix));
  },
};
