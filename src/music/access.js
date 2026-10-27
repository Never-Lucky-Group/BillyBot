import { PermissionFlagsBits } from 'discord.js';
import { logger } from '../lib/logger.js';
import { NOT_IN_VOICE, notDj, wrongChannel } from '../lib/replies.js';

// Used in a server that has not chosen a music channel or DJ role with !setup: the channel and
// role with these names, as before !setup existed.
export const DEFAULT_MUSIC_CHANNEL_NAME = 'music_bot';
export const DEFAULT_DJ_ROLE_NAME = 'DJ';

// The server's music channel and DJ role as { channelId, roleId }: the IDs chosen with !setup, or
// null for the default (matched by name). A chosen channel or role that has since been deleted
// also falls back to the default, so nobody is locked out of the music commands.
export function musicSetup(guild, settingsStore) {
  const { musicChannelId, djRoleId } = settingsStore.get(guild.id);
  const channelId =
    musicChannelId && guild.channels.cache.has(musicChannelId) ? musicChannelId : null;
  const roleId = djRoleId && guild.roles.cache.has(djRoleId) ? djRoleId : null;
  if (musicChannelId && !channelId) {
    logger.warn(
      { guildId: guild.id, channelId: musicChannelId },
      'Music channel is gone; using the default',
    );
  }
  if (djRoleId && !roleId) {
    logger.warn({ guildId: guild.id, roleId: djRoleId }, 'DJ role is gone; using the default');
  }
  return { channelId, roleId };
}

export function isMusicChannel(channel, setup) {
  return setup.channelId
    ? channel.id === setup.channelId
    : channel.name === DEFAULT_MUSIC_CHANNEL_NAME;
}

// The DJ role may be @everyone (same ID as the server), which every member has.
export function isDj(member, setup) {
  return setup.roleId
    ? member.roles.cache.has(setup.roleId)
    : member.roles.cache.some((role) => role.name === DEFAULT_DJ_ROLE_NAME);
}

// May use !setup and !leave: the server owner, or anyone with Manage Server (which Administrator
// includes).
export function isAdmin(member) {
  return (
    member.id === member.guild.ownerId || member.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

// Why the author may not use a music command (!play, !skip) here, as a reply, or null if they
// may. The checks, and their order, are the same as !play's before !setup existed.
export function musicDenial(message, { needsVoice = false } = {}) {
  const setup = musicSetup(message.guild, message.client.settingsStore);
  if (!isMusicChannel(message.channel, setup)) {
    const channel = setup.channelId ? `<#${setup.channelId}>` : DEFAULT_MUSIC_CHANNEL_NAME;
    return wrongChannel(message.author, channel);
  }
  if (needsVoice && !message.member.voice.channel) return NOT_IN_VOICE;
  if (!isDj(message.member, setup)) return notDj(message.author);
  return null;
}
