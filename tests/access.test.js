import { describe, expect, it } from 'vitest';
import { NOT_IN_VOICE } from '../src/lib/replies.js';
import { isAdmin, isDj, isMusicChannel, musicDenial, musicSetup } from '../src/music/access.js';
import { SettingsStore } from '../src/settings/store.js';
import {
  GUILD_ID,
  OWNER_ID,
  fakeGuild,
  fakeGuildMessage,
  fakeMember,
  fakeTextChannel,
  fakeVoiceChannel,
} from './helpers/fakes.js';

const JUKEBOX = { id: '200000000000000050', name: 'jukebox' };
const MUSIC_ROLE = { id: '500000000000000050', name: 'Music' };

// A store where this server chose `choice` with !setup.
function storeWith(choice) {
  return new SettingsStore(
    'unused.json',
    new Map([
      [
        GUILD_ID,
        { musicChannelId: null, djRoleId: null, updatedBy: OWNER_ID, updatedAt: 1, ...choice },
      ],
    ]),
  );
}

const guildWithJukebox = () => fakeGuild({ channels: [JUKEBOX], roles: [MUSIC_ROLE] });

describe('musicSetup', () => {
  it('uses the defaults (by name) without !setup', () => {
    expect(musicSetup(fakeGuild(), new SettingsStore('unused.json'))).toEqual({
      channelId: null,
      roleId: null,
    });
  });

  it('uses the chosen channel and role', () => {
    const setup = musicSetup(
      guildWithJukebox(),
      storeWith({ musicChannelId: JUKEBOX.id, djRoleId: MUSIC_ROLE.id }),
    );
    expect(setup).toEqual({ channelId: JUKEBOX.id, roleId: MUSIC_ROLE.id });
  });

  it('falls back to the defaults when the chosen channel or role was deleted', () => {
    const setup = musicSetup(
      fakeGuild(),
      storeWith({ musicChannelId: JUKEBOX.id, djRoleId: MUSIC_ROLE.id }),
    );
    expect(setup).toEqual({ channelId: null, roleId: null });
  });
});

describe('isMusicChannel and isDj', () => {
  const defaults = { channelId: null, roleId: null };
  const chosen = { channelId: JUKEBOX.id, roleId: MUSIC_ROLE.id };

  it('match the music_bot channel and the DJ role by name by default', () => {
    expect(isMusicChannel(fakeTextChannel(), defaults)).toBe(true);
    expect(isMusicChannel(fakeTextChannel({ name: 'general' }), defaults)).toBe(false);
    expect(isDj(fakeMember({ roles: ['DJ'] }), defaults)).toBe(true);
    expect(isDj(fakeMember({ roles: ['Member'] }), defaults)).toBe(false);
  });

  it('match only the chosen channel and role once set, not the old names', () => {
    expect(isMusicChannel(fakeTextChannel(JUKEBOX), chosen)).toBe(true);
    expect(isMusicChannel(fakeTextChannel(), chosen)).toBe(false);
    expect(isDj(fakeMember({ roles: [MUSIC_ROLE] }), chosen)).toBe(true);
    expect(isDj(fakeMember({ roles: ['DJ'] }), chosen)).toBe(false);
  });

  it('let everyone in when the DJ role is @everyone', () => {
    const everyone = { id: GUILD_ID, name: '@everyone' };
    expect(isDj(fakeMember({ roles: [everyone] }), { channelId: null, roleId: GUILD_ID })).toBe(
      true,
    );
  });
});

describe('isAdmin', () => {
  it('is the server owner or a member with Manage Server', () => {
    expect(isAdmin(fakeMember({ id: OWNER_ID }))).toBe(true);
    expect(isAdmin(fakeMember({ manageServer: true }))).toBe(true);
    expect(isAdmin(fakeMember({ roles: ['DJ'] }))).toBe(false);
  });
});

describe('musicDenial', () => {
  it('names the chosen channel when used elsewhere', () => {
    const guild = guildWithJukebox();
    const message = fakeGuildMessage({
      member: fakeMember({ voiceChannel: fakeVoiceChannel({ guild }), roles: [MUSIC_ROLE] }),
      client: { settingsStore: storeWith({ musicChannelId: JUKEBOX.id, djRoleId: MUSIC_ROLE.id }) },
    });
    expect(musicDenial(message)).toBe(
      `<@300000000000000001> please use the <#${JUKEBOX.id}> channel to use BillyTube.`,
    );
  });

  it('allows a DJ in the chosen channel', () => {
    const guild = guildWithJukebox();
    const message = fakeGuildMessage({
      member: fakeMember({ voiceChannel: fakeVoiceChannel({ guild }), roles: [MUSIC_ROLE] }),
      channel: fakeTextChannel(JUKEBOX),
      client: { settingsStore: storeWith({ musicChannelId: JUKEBOX.id, djRoleId: MUSIC_ROLE.id }) },
    });
    expect(musicDenial(message, { needsVoice: true })).toBeNull();
  });

  it('checks voice only when asked to', () => {
    const message = fakeGuildMessage({ member: fakeMember({ voiceChannel: null }) });
    expect(musicDenial(message, { needsVoice: true })).toBe(NOT_IN_VOICE);
    expect(musicDenial(message)).toBeNull();
  });
});
