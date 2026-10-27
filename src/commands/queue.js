import { QUEUE_EMPTY } from '../lib/replies.js';
import { send } from '../lib/send.js';
import { queueEmbed } from '../music/embeds.js';

export default {
  name: 'queue',
  async execute(message) {
    const player = message.client.players.get(message.guild.id);
    const nowPlaying = player?.nowPlaying ?? null;
    const queue = player?.queue ?? [];
    if (!nowPlaying && queue.length === 0) {
      await send(message.channel, QUEUE_EMPTY);
      return;
    }
    await send(message.channel, { embeds: [queueEmbed({ nowPlaying, queue })] });
  },
};
