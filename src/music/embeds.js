import { EmbedBuilder } from 'discord.js';
import { formatDuration } from '../lib/format.js';

// How many upcoming songs !queue lists. Keeps the embed well under Discord's size limits.
const QUEUE_LIST_LIMIT = 10;

// A song is { title, thumbnail, duration, url, videoUrl, requestedBy } (see commands/play.js).

export function nowPlayingEmbed(song) {
  return songEmbed(song)
    .setColor(0x1db954) // Spotify green 😎
    .setTitle('🎶 Now Playing');
}

export function addedToQueueEmbed(song) {
  return songEmbed(song).setColor(0x0099ff).setTitle('Added to Queue');
}

function songEmbed(song) {
  return new EmbedBuilder()
    .setURL(song.url)
    .setDescription(song.title)
    .setThumbnail(song.thumbnail)
    .addFields(
      { name: 'Requested by', value: song.requestedBy, inline: true },
      { name: 'Duration', value: formatDuration(song.duration), inline: true },
    )
    .setTimestamp()
    .setFooter({ text: 'BillyTube' });
}

// The upcoming songs, not counting the one playing.
export function queueEmbed(queue) {
  const lines = queue.slice(0, QUEUE_LIST_LIMIT).map((song, index) => {
    const duration = song.duration ? ` \`[${formatDuration(song.duration)}]\`` : '';
    return `**${index + 1}.** ${song.title || 'Untitled'}${duration} – *${song.requestedBy}*`;
  });

  return new EmbedBuilder()
    .setColor(0xffa500)
    .setTitle('🎶 Current Queue')
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Total in queue: ${queue.length}` })
    .setTimestamp();
}
