import { getVoiceConnection } from '@discordjs/voice';

// Leaves without a reply, and does nothing if the bot is not in voice.
export default {
  name: 'leave',
  async execute(message) {
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
