// Recognises the link in a !play command. Only YouTube videos are played. Spotify links are
// recognised so the user can be told they are no longer supported (they were before 3.1).

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
]);
const SHORT_YOUTUBE_HOSTS = new Set(['youtu.be', 'www.youtu.be']);
const SPOTIFY_HOSTS = new Set(['open.spotify.com', 'play.spotify.com', 'spotify.link']);

// youtube.com paths that have the video ID as the next segment, e.g. /shorts/<id>.
const VIDEO_ID_PATHS = new Set(['shorts', 'live', 'embed', 'v']);
const VIDEO_ID = /^[\w-]{11}$/;

// Looks through the words after !play for the first YouTube or Spotify link. Returns one of:
//   { type: 'youtube', url, videoUrl }  url is the link as given (shown in embeds); videoUrl is
//                                       the plain watch URL handed to yt-dlp
//   { type: 'spotify' }
//   { type: 'unsupported' }             no link, another site, or a YouTube link with no video
//                                       (e.g. a channel or playlist page)
export function parsePlayLink(args) {
  for (const arg of args) {
    const url = toUrl(arg);
    if (!url) continue;

    if (url.protocol === 'spotify:') return { type: 'spotify' };
    const host = url.hostname.toLowerCase();
    if (SPOTIFY_HOSTS.has(host)) return { type: 'spotify' };

    const videoId = findVideoId(url, host);
    if (videoId) {
      return {
        type: 'youtube',
        url: url.href,
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
      };
    }
  }
  return { type: 'unsupported' };
}

function toUrl(text) {
  // Discord users wrap links in <> to stop the preview.
  let candidate = text.replace(/^<(.*)>$/, '$1');
  if (!/^[a-z][a-z\d+.-]*:/i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  return ['https:', 'http:', 'spotify:'].includes(url.protocol) ? url : null;
}

function findVideoId(url, host) {
  let id = null;
  if (SHORT_YOUTUBE_HOSTS.has(host)) {
    id = url.pathname.split('/')[1];
  } else if (YOUTUBE_HOSTS.has(host)) {
    const [, first, second] = url.pathname.split('/');
    if (first === 'watch') id = url.searchParams.get('v');
    else if (VIDEO_ID_PATHS.has(first)) id = second;
  }
  return id && VIDEO_ID.test(id) ? id : null;
}
