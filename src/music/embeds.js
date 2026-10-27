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

// Posted as soon as !play gets a YouTube link, then edited into the result: Now Playing, Added to
// Queue, or an error (see commands/play.js and GuildPlayer).
export function searchingEmbed(url, requestedBy) {
  return new EmbedBuilder()
    .setColor(0x95a5a6)
    .setTitle('🔎 Searching…')
    .setDescription(url)
    .addFields({ name: 'Requested by', value: requestedBy, inline: true })
    .setTimestamp()
    .setFooter({ text: 'BillyTube' });
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

export const NOTHING_QUEUED = 'Nothing queued.';

// For !queue: the song playing (GuildPlayer's nowPlaying, or null between songs) above the
// upcoming songs. The total counts only the upcoming songs.
export function queueEmbed({ nowPlaying, queue }) {
  const sections = [];
  if (nowPlaying) sections.push(nowPlayingLine(nowPlaying));
  if (queue.length > 0) {
    const lines = queue.slice(0, QUEUE_LIST_LIMIT).map((song, index) => {
      const duration = song.duration ? ` \`[${formatDuration(song.duration)}]\`` : '';
      return `**${index + 1}.** ${song.title || 'Untitled'}${duration} – *${song.requestedBy}*`;
    });
    sections.push(lines.join('\n'));
  } else {
    sections.push(NOTHING_QUEUED);
  }

  return new EmbedBuilder()
    .setColor(0xffa500)
    .setTitle('🎶 Current Queue')
    .setDescription(sections.join('\n\n'))
    .setFooter({ text: `Total in queue: ${queue.length}` })
    .setTimestamp();
}

// e.g. "▶️ Now playing: Title `[1:24 / 3:33]` – *user*". A livestream has no length, so it shows
// only the time played.
function nowPlayingLine({ song, elapsedMs }) {
  const total = Number(song.duration);
  const hasLength = song.duration !== null && song.duration !== undefined && total > 0;
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const elapsed = formatDuration(hasLength ? Math.min(elapsedSeconds, total) : elapsedSeconds);
  const progress = hasLength ? `${elapsed} / ${formatDuration(total)}` : elapsed;
  return `▶️ Now playing: ${song.title || 'Untitled'} \`[${progress}]\` – *${song.requestedBy}*`;
}
