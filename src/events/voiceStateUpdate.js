import { Events } from 'discord.js';
import { logger } from '../lib/logger.js';

// Leaves voice when nobody but bots is left in the bot's channel.
export default {
  name: Events.VoiceStateUpdate,
  execute(oldState, newState) {
    const guild = newState.guild;
    const player = guild.client.players.get(guild.id);
    if (!player) return;

    const channelId = player.channelId;
    const listeners = guild.voiceStates.cache.filter(
      (state) =>
        state.channelId === channelId &&
        state.id !== guild.client.user.id &&
        // A member who is not cached counts as a listener, so the bot never leaves people.
        !state.member?.user.bot,
    );
    if (listeners.size === 0) {
      logger.info({ guildId: guild.id, channelId }, 'Alone in the voice channel; leaving');
      player.destroy();
    }
  },
};
