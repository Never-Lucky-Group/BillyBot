// Every message the bot sends that is not an embed, kept in one place so wording changes are easy to
// review. The texts and their typos are kept from before the 3.1 rewrite unless marked "new in 3.1".

export function helpText(prefix) {
  const p = prefix;
  return `Global commands:\n${p}help , ${p}patchnotes , ${p}leave , ${p}play [youtube url], ${p}skip, ${p}queue`;
}

export const PATCH_NOTES =
  'BillyBot Patch 3.1:\n\n' +
  '- Songs start playing faster.\n' +
  '- Fixed bugs that could crash BillyBot or leave it stuck in a voice channel.\n' +
  '- Spotify links are no longer supported.\n';

// !play
export const wrongChannel = (user) => `${user} please use the music_bot channel to use BillyTube.`;
export const NOT_IN_VOICE = 'You need to be in a voice channel to play Billy.';
export const notDj = (user) =>
  `${user} I'm sorrrry. You don't have the required privleges to use BillyTube.`;
export const UNSUPPORTED_LINK = 'Only links from www.youtube.com are supported.';
// New in 3.1.
export const SPOTIFY_UNSUPPORTED =
  'Spotify links are no longer supported. Please use a YouTube link instead.';
export const DOWNLOAD_FAILED = 'Failed to download audio.';
// New in 3.1: joining voice used to fail silently.
export const NO_VOICE_PERMISSION =
  "I don't have permission to join and speak in your voice channel.";
export const VOICE_CONNECT_FAILED = "I couldn't connect to the voice channel. Please try again.";

// !skip and !queue
export const SKIP_NOT_IN_VOICE = 'I need to be in a voice channel to skip songs.';
export const NOTHING_PLAYING = 'There is no active song playing.';
export const QUEUE_EMPTY = 'The queue is currently empty.';

// Direct messages
export const DM_NOT_UNDERSTOOD = "I don't understand what you are saying.";
export const loveReply = (username) => `I love you too ${username}`;
