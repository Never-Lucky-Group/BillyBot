import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, loadEasterEggs, loadEnv, parseEasterEggs } from '../src/config.js';

const EGG = {
  keyword: 'Billy',
  userId: '300000000000000001',
  reply: 'Hi Billy.',
  otherReply: 'You are not Billy.',
};

describe('loadEnv', () => {
  it('applies defaults when only the token is set', () => {
    expect(loadEnv({ DISCORD_TOKEN: 'token' })).toEqual({
      token: 'token',
      prefix: '!',
      logLevel: 'info',
      easterEggsPath: 'easter-eggs.json',
      ytdlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
    });
  });

  it('treats empty values as unset', () => {
    expect(loadEnv({ DISCORD_TOKEN: 'token', PREFIX: '', LOG_LEVEL: '' })).toMatchObject({
      prefix: '!',
      logLevel: 'info',
    });
  });

  it('reads every setting', () => {
    expect(
      loadEnv({
        DISCORD_TOKEN: 'token',
        PREFIX: '?',
        LOG_LEVEL: 'debug',
        EASTER_EGGS_PATH: '/etc/billybot/eggs.json',
        YTDLP_PATH: '/usr/local/bin/yt-dlp',
        FFMPEG_PATH: '/usr/bin/ffmpeg',
      }),
    ).toEqual({
      token: 'token',
      prefix: '?',
      logLevel: 'debug',
      easterEggsPath: '/etc/billybot/eggs.json',
      ytdlpPath: '/usr/local/bin/yt-dlp',
      ffmpegPath: '/usr/bin/ffmpeg',
    });
  });

  it.each([
    [{}, 'DISCORD_TOKEN'],
    [{ DISCORD_TOKEN: 'token', PREFIX: '! ' }, 'PREFIX'],
    [{ DISCORD_TOKEN: 'token', LOG_LEVEL: 'loud' }, 'LOG_LEVEL'],
  ])('rejects %j', (env, field) => {
    expect(() => loadEnv(env)).toThrow(ConfigError);
    expect(() => loadEnv(env)).toThrow(field);
  });
});

describe('parseEasterEggs', () => {
  it('keys easter eggs by lowercase keyword', () => {
    const eggs = parseEasterEggs([EGG]);
    expect([...eggs.keys()]).toEqual(['billy']);
    expect(eggs.get('billy')).toMatchObject({ userId: EGG.userId, reply: 'Hi Billy.' });
  });

  it.each([
    ['not a list', { keyword: 'x' }],
    ['a bad user ID', [{ ...EGG, userId: '123' }]],
    ['a missing reply', [{ ...EGG, otherReply: undefined }]],
    ['an unknown field', [{ ...EGG, extra: true }]],
    ['duplicate keywords', [EGG, { ...EGG, keyword: 'BILLY' }]],
    ['a keyword the bot already answers', [{ ...EGG, keyword: 'Help' }]],
  ])('rejects %s', (_label, raw) => {
    expect(() => parseEasterEggs(raw)).toThrow(ConfigError);
  });
});

describe('loadEasterEggs', () => {
  let directory;
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('returns null when the file does not exist', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'billybot-'));
    expect(await loadEasterEggs(path.join(directory, 'missing.json'))).toBeNull();
  });

  it('loads a valid file', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'billybot-'));
    const file = path.join(directory, 'eggs.json');
    await writeFile(file, JSON.stringify([EGG]));
    expect((await loadEasterEggs(file)).size).toBe(1);
  });

  it('rejects a file that is not JSON', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'billybot-'));
    const file = path.join(directory, 'eggs.json');
    await writeFile(file, '{ not json');
    await expect(loadEasterEggs(file)).rejects.toThrow(ConfigError);
  });

  it('accepts the example file in the repository', async () => {
    const examplePath = path.join(import.meta.dirname, '..', 'easter-eggs.example.json');
    expect((await loadEasterEggs(examplePath)).size).toBe(1);
  });
});
