import { NOTHING_PLAYING, SKIP_NOT_IN_VOICE } from '../lib/replies.js';
import { send } from '../lib/send.js';
import { musicDenial } from '../music/access.js';

// In the music channel, with the DJ role.
export default {
  name: 'skip',
  async execute(message) {
    const denial = musicDenial(message);
    if (denial) {
      await send(message.channel, denial);
      return;
    }
    const player = message.client.players.get(message.guild.id);
    if (!player) {
      await send(message.channel, SKIP_NOT_IN_VOICE);
      return;
    }
    // The next song's "Now Playing" is the reply.
    if (!player.skip()) await send(message.channel, NOTHING_PLAYING);
  },
};
