import { describe, expect, it, vi } from 'vitest';
import voiceStateUpdate from '../src/events/voiceStateUpdate.js';
import { BOT_USER_ID, VOICE_CHANNEL_ID, fakeGuild } from './helpers/fakes.js';

const voiceState = (id, { channelId = VOICE_CHANNEL_ID, bot = false, cached = true } = {}) => ({
  id,
  channelId,
  member: cached ? { user: { bot } } : null,
});

function run(voiceStates, player = { channelId: VOICE_CHANNEL_ID, destroy: vi.fn() }) {
  const guild = fakeGuild({ voiceStates });
  guild.client.players = { get: () => player };
  voiceStateUpdate.execute({ guild }, { guild });
  return player;
}

describe('voiceStateUpdate', () => {
  it('leaves when only bots are left in its channel', () => {
    const player = run([
      voiceState(BOT_USER_ID, { bot: true }),
      voiceState('300000000000000002', { bot: true }),
      voiceState('300000000000000003', { channelId: '200000000000000999' }),
    ]);
    expect(player.destroy).toHaveBeenCalled();
  });

  it('stays while someone is listening', () => {
    const player = run([voiceState(BOT_USER_ID, { bot: true }), voiceState('300000000000000002')]);
    expect(player.destroy).not.toHaveBeenCalled();
  });

  it('counts a listener whose member is not cached', () => {
    const player = run([
      voiceState(BOT_USER_ID, { bot: true }),
      voiceState('300000000000000002', { cached: false }),
    ]);
    expect(player.destroy).not.toHaveBeenCalled();
  });

  it('does nothing when the bot is not playing in the server', () => {
    expect(() => run([], undefined)).not.toThrow();
  });
});
