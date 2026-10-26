import { describe, expect, it } from 'vitest';
import { parsePlayLink } from '../src/music/links.js';

const ID = 'dQw4w9WgXcQ';
const WATCH_URL = `https://www.youtube.com/watch?v=${ID}`;

describe('parsePlayLink', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}&si=abc`,
    `https://www.youtube.com/watch?v=${ID}&list=PL1234567890`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `www.youtube.com/watch?v=${ID}`,
    `youtu.be/${ID}`,
    `<https://youtu.be/${ID}>`,
  ])('plays the video in %s', (link) => {
    expect(parsePlayLink([link])).toEqual({
      type: 'youtube',
      url: expect.any(String),
      videoUrl: WATCH_URL,
    });
  });

  it('keeps the link as given for embeds and hands yt-dlp the plain watch URL', () => {
    expect(parsePlayLink([`https://youtu.be/${ID}?si=abc`])).toEqual({
      type: 'youtube',
      url: `https://youtu.be/${ID}?si=abc`,
      videoUrl: WATCH_URL,
    });
  });

  it('finds the link among other words', () => {
    expect(parsePlayLink(['this', 'one', `https://youtu.be/${ID}`, 'please']).type).toBe('youtube');
  });

  it.each([
    'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
    'https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3',
    'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc',
    'open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
    'https://spotify.link/abcdef',
    'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
  ])('recognises the Spotify link %s', (link) => {
    expect(parsePlayLink([link])).toEqual({ type: 'spotify' });
  });

  it.each([
    [[]],
    [['never', 'gonna', 'give', 'you', 'up']],
    [['https://example.com/watch?v=dQw4w9WgXcQ']],
    // Used to be accepted because it contains "youtube.com".
    [['https://example.com/?youtube.com']],
    [['https://notyoutube.com/watch?v=dQw4w9WgXcQ']],
    [['https://www.youtube.com/playlist?list=PL1234567890']],
    [['https://www.youtube.com/@SomeChannel']],
    [['https://www.youtube.com/watch?v=tooshort']],
    [['https://www.youtube.com/watch']],
    [['javascript:alert(1)']],
    [['file:///etc/passwd']],
  ])('rejects %j', (args) => {
    expect(parsePlayLink(args)).toEqual({ type: 'unsupported' });
  });
});
