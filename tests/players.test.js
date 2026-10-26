import { describe, expect, it } from 'vitest';
import { PlayerRegistry } from '../src/music/players.js';
import { GUILD_ID, fakeMedia, fakeTextChannel, fakeVoiceChannel } from './helpers/fakes.js';

function setUp() {
  const created = [];
  const registry = new PlayerRegistry({
    media: fakeMedia(),
    createPlayer: (options) => {
      const player = { options, destroy: () => options.onDestroy(player) };
      created.push(player);
      return player;
    },
  });
  const channels = { voiceChannel: fakeVoiceChannel(), textChannel: fakeTextChannel() };
  return { registry, created, channels };
}

describe('PlayerRegistry', () => {
  it('creates one player per server and hands it the media', () => {
    const { registry, created, channels } = setUp();
    const player = registry.getOrCreate(channels);

    expect(registry.getOrCreate(channels)).toBe(player);
    expect(registry.get(GUILD_ID)).toBe(player);
    expect(created).toHaveLength(1);
    expect(player.options.media.fetchSongInfo).toBeTypeOf('function');
  });

  it('forgets a destroyed player and counts the leave', () => {
    const { registry, channels } = setUp();
    const player = registry.getOrCreate(channels);
    expect(registry.leaveCount(GUILD_ID)).toBe(0);

    player.destroy();

    expect(registry.get(GUILD_ID)).toBeUndefined();
    expect(registry.leaveCount(GUILD_ID)).toBe(1);
    expect(registry.getOrCreate(channels)).not.toBe(player);
  });

  it('destroys every player', () => {
    const { registry, channels } = setUp();
    registry.getOrCreate(channels);
    registry.getOrCreate({
      ...channels,
      voiceChannel: { ...channels.voiceChannel, guild: { id: '100000000000000002' } },
    });

    registry.destroyAll();

    expect(registry.get(GUILD_ID)).toBeUndefined();
    expect(registry.get('100000000000000002')).toBeUndefined();
  });
});
