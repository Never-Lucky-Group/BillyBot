import { logger } from '../lib/logger.js';
import {
  DOWNLOAD_FAILED,
  NOT_IN_VOICE,
  SPOTIFY_UNSUPPORTED,
  UNSUPPORTED_LINK,
  notDj,
  wrongChannel,
} from '../lib/replies.js';
import { editOrSend, remove, send } from '../lib/send.js';
import { addedToQueueEmbed, searchingEmbed } from '../music/embeds.js';
import { parsePlayLink } from '../music/links.js';

// !play only works in a channel with this name, for members with a role of this name.
export const MUSIC_CHANNEL_NAME = 'music_bot';
export const DJ_ROLE_NAME = 'DJ';

// Why the author may not use !play here, as a reply, or null if they may.
export function playDenial(message) {
  if (message.channel.name !== MUSIC_CHANNEL_NAME) return wrongChannel(message.author);
  if (!message.member.voice.channel) return NOT_IN_VOICE;
  if (!message.member.roles.cache.some((role) => role.name === DJ_ROLE_NAME)) {
    return notDj(message.author);
  }
  return null;
}

// Returns the stream, or null if it could not be opened; the player then opens it again later.
function openEarly(media, videoUrl, guildId) {
  try {
    return media.openAudioStream(videoUrl);
  } catch (error) {
    logger.warn({ err: error, guildId }, 'Could not open the stream early');
    return null;
  }
}

export default {
  name: 'play',
  async execute(message, args) {
    const denial = playDenial(message);
    if (denial) {
      await send(message.channel, denial);
      return;
    }

    const link = parsePlayLink(args);
    if (link.type === 'spotify') {
      await send(message.channel, SPOTIFY_UNSUPPORTED);
      return;
    }
    if (link.type !== 'youtube') {
      await send(message.channel, UNSUPPORTED_LINK);
      return;
    }

    const { media, players } = message.client;
    const guildId = message.guild.id;
    const requestedChannel = message.member.voice.channel;
    const leaveCount = players.leaveCount(guildId);

    // If nothing is playing, the song will start as soon as it is looked up, so its stream is
    // opened now rather than after the lookup: both take seconds.
    const existing = players.get(guildId);
    const claimed = (!existing || existing.idle) && players.claimEarlyStream(guildId);
    const audio = claimed ? openEarly(media, link.videoUrl, guildId) : null;

    // A "Searching…" card so the requester sees the bot working; it is edited into the result
    // later. Sent alongside the lookup, so neither waits for the other. Null if it could not be
    // sent, and then the result is sent as a new message instead.
    const statusSent = send(message.channel, {
      embeds: [searchingEmbed(link.url, message.author.username)],
    });

    let info;
    let status;
    try {
      info = await media.fetchSongInfo(link.videoUrl);
      // Sending takes well under the lookup's seconds, so this rarely waits.
      status = await statusSent;
    } catch (error) {
      audio?.stop();
      logger.warn({ err: error, guildId, url: link.videoUrl }, 'Could not look up a song');
      await editOrSend(await statusSent, message.channel, DOWNLOAD_FAILED);
      return;
    } finally {
      // From here to enqueue() nothing waits, so no other !play can slip in between.
      if (claimed) players.releaseEarlyStream(guildId);
    }

    if (players.leaveCount(guildId) !== leaveCount) {
      audio?.stop();
      if (status) void remove(status);
      logger.info({ guildId, title: info.title }, 'Dropping a song requested before leaving voice');
      return;
    }

    const song = {
      ...info,
      url: link.url,
      videoUrl: link.videoUrl,
      requestedBy: message.author.username,
    };
    const player = players.getOrCreate({
      // The requester may have left voice while the song was looked up.
      voiceChannel: message.member.voice.channel ?? requestedChannel,
      textChannel: message.channel,
    });
    logger.info({ guildId, title: song.title }, 'Queued song');
    // A song that starts right away keeps its card: the player turns it into Now Playing.
    if (!player.enqueue(song, { audio, statusMessage: status })) {
      await editOrSend(status, message.channel, { embeds: [addedToQueueEmbed(song)] });
    }
  },
};
