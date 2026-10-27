// Every message the bot sends that is not an embed, kept in one place so wording changes are easy to
// review. The texts and their typos are kept from before the 3.1 rewrite unless marked "new in 3.1".

export function helpText(prefix) {
  const p = prefix;
  return `Global commands:\n${p}help , ${p}patchnotes , ${p}leave , ${p}play [youtube url], ${p}skip, ${p}queue`;
}

export const PATCH_NOTES =
  'BillyBot Patch 3.1:\n\n' +
  '- Songs start playing faster.\n' +
  '- !play now shows a 🔎 Searching… card right away, which turns into Now Playing or Added to Queue.\n' +
  '- Fixed bugs that could crash BillyBot or leave it stuck in a voice channel.\n' +
  '- !queue now shows the song that is playing and how far into it it is.\n' +
  '- Server owners and admins can choose the music channel and DJ role with !setup.\n' +
  '- !skip now needs the music channel and DJ role, like !play.\n' +
  '- !leave is now for admins only.\n' +
  '- BillyBot leaves by itself after 30 minutes without music.\n' +
  '- Spotify links are no longer supported.\n';

// !play and !skip. `channel` is the server's music channel: a mention, or "music_bot" by default.
export const wrongChannel = (user, channel) =>
  `${user} please use the ${channel} channel to use BillyTube.`;
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

// !setup and !leave. New in 3.1: !leave used to work for everyone.
export const notAdminSetup = (prefix) =>
  `Only the server owner or members with Manage Server can use ${prefix}setup.`;
export const NOT_ADMIN_LEAVE =
  'Only the server owner or members with Manage Server can make BillyBot leave.';
export const setupNotYours = (prefix) =>
  `Only the person who opened this setup panel can use it. Run ${prefix}setup to open your own.`;
export const SETUP_SAVE_FAILED = "Couldn't save the settings. Please try again.";

// Direct messages
export const DM_NOT_UNDERSTOOD = "I don't understand what you are saying.";
export const loveReply = (username) => `I love you too ${username}`;
