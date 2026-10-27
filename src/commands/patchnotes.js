import { PATCH_NOTES } from '../lib/replies.js';
import { send } from '../lib/send.js';

export default {
  name: 'patchnotes',
  async execute(message) {
    await send(message.channel, PATCH_NOTES);
  },
};
