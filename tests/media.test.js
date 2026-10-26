import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createMedia } from '../src/music/media.js';
import { flush } from './helpers/fakes.js';

const VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

// A child process whose output and exit the test controls.
function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn((signal) => child.exit(null, signal));
  child.exit = (code, signal = null) => {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit('close', code, signal);
  };
  return child;
}

function setUp() {
  const children = [];
  const spawnProcess = vi.fn((command, args, options) => {
    const child = fakeChild();
    children.push({ command, args, options, child });
    return child;
  });
  const media = createMedia({ ytdlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg', spawnProcess });
  return { media, children };
}

describe('fetchSongInfo', () => {
  it('asks yt-dlp for only the shown fields, with the URL after --', async () => {
    const { media, children } = setUp();
    const pending = media.fetchSongInfo(VIDEO_URL);
    const [{ command, args, options, child }] = children;
    child.stdout.write(
      '{"title": "Never Gonna Give You Up", "thumbnail": "https://i.ytimg.com/x.jpg", "duration": 213}\n',
    );
    child.exit(0);

    expect(await pending).toEqual({
      title: 'Never Gonna Give You Up',
      thumbnail: 'https://i.ytimg.com/x.jpg',
      duration: 213,
    });
    expect(command).toBe('yt-dlp');
    expect(args.slice(-2)).toEqual(['--', VIDEO_URL]);
    expect(args).toContain('--no-playlist');
    expect(args[args.indexOf('--js-runtimes') + 1]).toBe(`node:${process.execPath}`);
    expect(options.timeout).toBeGreaterThan(0);
  });

  it('fills in missing details', async () => {
    const { media, children } = setUp();
    const pending = media.fetchSongInfo(VIDEO_URL);
    children[0].child.stdout.write('{}\n');
    children[0].child.exit(0);
    expect(await pending).toEqual({ title: 'Unknown Title', thumbnail: null, duration: null });
  });

  it('rejects with the error output when yt-dlp fails', async () => {
    const { media, children } = setUp();
    const pending = media.fetchSongInfo(VIDEO_URL);
    children[0].child.stderr.write('ERROR: Video unavailable\n');
    await flush();
    children[0].child.exit(1);
    await expect(pending).rejects.toThrow('ERROR: Video unavailable');
  });

  it('rejects when yt-dlp is not installed', async () => {
    const { media, children } = setUp();
    const pending = media.fetchSongInfo(VIDEO_URL);
    children[0].child.emit(
      'error',
      Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' }),
    );
    await expect(pending).rejects.toThrow('ENOENT');
  });

  it('rejects when yt-dlp prints nothing', async () => {
    const { media, children } = setUp();
    const pending = media.fetchSongInfo(VIDEO_URL);
    children[0].child.exit(0);
    await expect(pending).rejects.toThrow('no song details');
  });
});

describe('openAudioStream', () => {
  it('pipes yt-dlp into ffmpeg and returns ffmpeg Ogg Opus output', async () => {
    const { media, children } = setUp();
    const audio = media.openAudioStream(VIDEO_URL);
    const [ytdlp, ffmpeg] = children;

    expect(ytdlp.command).toBe('yt-dlp');
    expect(ytdlp.args.slice(-2)).toEqual(['--', VIDEO_URL]);
    expect(ytdlp.args[ytdlp.args.indexOf('--output') + 1]).toBe('-');
    expect(ffmpeg.command).toBe('ffmpeg');
    expect(ffmpeg.args).toEqual(expect.arrayContaining(['-c:a', 'libopus', '-f', 'ogg', 'pipe:1']));
    expect(audio.stream).toBe(ffmpeg.child.stdout);

    const received = [];
    ffmpeg.child.stdin.on('data', (chunk) => received.push(String(chunk)));
    ytdlp.child.stdout.write('audio bytes');
    await flush();
    expect(received).toEqual(['audio bytes']);
  });

  it('reports a failing program once, with its error output', async () => {
    const { media, children } = setUp();
    const onError = vi.fn();
    media.openAudioStream(VIDEO_URL, { onError });
    const [ytdlp, ffmpeg] = children;

    ytdlp.child.stderr.write('ERROR: Sign in to confirm your age');
    await flush();
    ytdlp.child.exit(1);
    ffmpeg.child.exit(1);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].message).toContain('Sign in to confirm your age');
  });

  it('does not report a song that finishes normally', () => {
    const { media, children } = setUp();
    const onError = vi.fn();
    media.openAudioStream(VIDEO_URL, { onError });
    children[0].child.exit(0);
    children[1].child.exit(0);
    expect(onError).not.toHaveBeenCalled();
  });

  it('stop() kills programs still running without reporting an error', () => {
    const { media, children } = setUp();
    const onError = vi.fn();
    const audio = media.openAudioStream(VIDEO_URL, { onError });
    children[0].child.exit(0);

    audio.stop();

    expect(children[0].child.kill).not.toHaveBeenCalled();
    expect(children[1].child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(onError).not.toHaveBeenCalled();
  });

  it('survives the pipe breaking when ffmpeg ends first', async () => {
    const { media, children } = setUp();
    media.openAudioStream(VIDEO_URL);
    const error = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    expect(() => children[1].child.stdin.emit('error', error)).not.toThrow();
    expect(() => children[0].child.stdout.emit('error', error)).not.toThrow();
  });
});

describe('checkTools', () => {
  it('never rejects, even when the tools are missing', async () => {
    const { media, children } = setUp();
    const pending = media.checkTools();
    children[0].child.emit('error', new Error('spawn yt-dlp ENOENT'));
    await flush();
    children[1].child.stdout.write('ffmpeg version 6.1.1\n');
    children[1].child.exit(0);
    await expect(pending).resolves.toBeUndefined();
  });
});
