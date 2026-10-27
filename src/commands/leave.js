import { getVoiceConnection } from '@discordjs/voice';
import { NOT_ADMIN_LEAVE } from '../lib/replies.js';
import { send } from '../lib/send.js';
import { isAdmin } from '../music/access.js';

// Admins only, from any channel. Leaves without a reply, and does nothing if the bot is not in
// voice. Everyone else relies on the bot leaving by itself: when it is alone in the channel, or
// after 30 minutes without music.
export default {
  name: 'leave',
  async execute(message) {
    if (!isAdmin(message.member)) {
      await send(message.channel, NOT_ADMIN_LEAVE);
      return;
    }
    const guildId = message.guild.id;
    const player = message.client.players.get(guildId);
    if (player) {
      player.destroy();
      return;
    }
    // A connection without a player should not exist, but would otherwise keep the bot in voice.
    getVoiceConnection(guildId)?.destroy();
  },
};
