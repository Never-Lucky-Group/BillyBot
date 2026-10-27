import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../src/config.js';
import { SettingsStore } from '../src/settings/store.js';

const GUILD = '100000000000000001';
const OTHER_GUILD = '100000000000000002';
const CHANNEL = '200000000000000001';
const ROLE = '500000000000000001';
const USER = '300000000000000001';

describe('SettingsStore', () => {
  let directory;
  let filePath;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'billybot-settings-'));
    filePath = path.join(directory, 'data', 'settings.json');
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  it('starts empty when the file does not exist yet', async () => {
    const store = await SettingsStore.load(filePath);
    expect(store.size).toBe(0);
    expect(store.get(GUILD)).toEqual({ musicChannelId: null, djRoleId: null });
  });

  it('saves a server’s choices, creating the folder, and reads them back', async () => {
    const store = await SettingsStore.load(filePath);
    await store.set(GUILD, { musicChannelId: CHANNEL, djRoleId: ROLE }, USER, 1_700_000_000);

    expect(store.get(GUILD)).toEqual({ musicChannelId: CHANNEL, djRoleId: ROLE });
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({
      [GUILD]: {
        musicChannelId: CHANNEL,
        djRoleId: ROLE,
        updatedBy: USER,
        updatedAt: 1_700_000_000,
      },
    });
    const reloaded = await SettingsStore.load(filePath);
    expect(reloaded.get(GUILD)).toEqual({ musicChannelId: CHANNEL, djRoleId: ROLE });
    expect(reloaded.get(OTHER_GUILD)).toEqual({ musicChannelId: null, djRoleId: null });
  });

  it('keeps one setting at its default when only the other is chosen', async () => {
    const store = await SettingsStore.load(filePath);
    await store.set(GUILD, { musicChannelId: null, djRoleId: ROLE }, USER);
    expect(store.get(GUILD)).toEqual({ musicChannelId: null, djRoleId: ROLE });
  });

  it('removes a server’s entry when both go back to the defaults', async () => {
    const store = await SettingsStore.load(filePath);
    await store.set(GUILD, { musicChannelId: CHANNEL, djRoleId: ROLE }, USER);
    await store.set(GUILD, { musicChannelId: null, djRoleId: null }, USER);
    expect(store.size).toBe(0);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({});
  });

  it('writes changes in order, so the last one wins', async () => {
    const store = await SettingsStore.load(filePath);
    await Promise.all([
      store.set(GUILD, { musicChannelId: CHANNEL, djRoleId: null }, USER),
      store.set(GUILD, { musicChannelId: null, djRoleId: ROLE }, USER),
    ]);
    const reloaded = await SettingsStore.load(filePath);
    expect(reloaded.get(GUILD)).toEqual({ musicChannelId: null, djRoleId: ROLE });
  });

  it('keeps the old settings and throws when saving fails', async () => {
    const store = await SettingsStore.load(filePath);
    await store.set(GUILD, { musicChannelId: CHANNEL, djRoleId: null }, USER);
    // The temporary file's path is a folder, so writing it fails.
    await mkdir(`${filePath}.tmp`);

    await expect(
      store.set(GUILD, { musicChannelId: null, djRoleId: ROLE }, USER),
    ).rejects.toThrow();
    expect(store.get(GUILD)).toEqual({ musicChannelId: CHANNEL, djRoleId: null });
  });

  it.each([
    ['not JSON', '{ not json'],
    ['not a server map', '[]'],
    [
      'a bad channel ID',
      JSON.stringify({
        [GUILD]: { musicChannelId: 'x', djRoleId: null, updatedBy: USER, updatedAt: 1 },
      }),
    ],
    [
      'an unknown field',
      JSON.stringify({
        [GUILD]: { musicChannelId: null, djRoleId: null, updatedBy: USER, updatedAt: 1, extra: 1 },
      }),
    ],
  ])('refuses to start with a file that is %s, rather than overwrite it', async (_label, text) => {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, text);
    await expect(SettingsStore.load(filePath)).rejects.toThrow(ConfigError);
  });
});
