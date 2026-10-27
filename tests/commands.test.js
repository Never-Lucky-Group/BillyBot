import { describe, expect, it, vi } from 'vitest';
import help from '../src/commands/help.js';
import leave from '../src/commands/leave.js';
import patchnotes from '../src/commands/patchnotes.js';
import queue from '../src/commands/queue.js';
import skip from '../src/commands/skip.js';
import {
  NOTHING_PLAYING,
  NOT_ADMIN_LEAVE,
  PATCH_NOTES,
  QUEUE_EMPTY,
  SKIP_NOT_IN_VOICE,
} from '../src/lib/replies.js';
import {
  OWNER_ID,
  fakeGuildMessage,
  fakeMember,
  fakeSong,
  fakeTextChannel,
} from './helpers/fakes.js';

// By default a DJ in the music_bot channel, without Manage Server.
function messageWith(player, { member, channel } = {}) {
  return fakeGuildMessage({
    member,
    channel,
    client: { players: { get: vi.fn(() => player) } },
  });
}

describe('!help', () => {
  it('DMs the command list with the configured prefix', async () => {
    const message = messageWith(undefined);
    message.client.settings.prefix = '?';
    await help.execute(message, []);
    expect(message.author.send).toHaveBeenCalledWith(
      'Global commands:\n?help , ?patchnotes , ?leave , ?play [youtube url], ?skip, ?queue',
    );
  });

  it('does not throw when the author has DMs closed', async () => {
    const message = messageWith(undefined);
    message.author.send.mockRejectedValueOnce(new Error('Cannot send messages to this user'));
    await expect(help.execute(message, [])).resolves.toBeUndefined();
  });
});

describe('!patchnotes', () => {
  it('posts the patch notes in the channel', async () => {
    const message = messageWith(undefined);
    await patchnotes.execute(message, []);
    expect(message.channel.send).toHaveBeenCalledWith(PATCH_NOTES);
    expect(PATCH_NOTES).toMatch(/^BillyBot Patch 3\.1:/);
  });
});

describe('!skip', () => {
  it('only works in the music channel', async () => {
    const player = { skip: vi.fn(() => true) };
    const message = messageWith(player, { channel: fakeTextChannel({ name: 'general' }) });
    await skip.execute(message, []);
    expect(player.skip).not.toHaveBeenCalled();
    expect(message.channel.send).toHaveBeenCalledWith(
      '<@300000000000000001> please use the music_bot channel to use BillyTube.',
    );
  });

  it('needs the DJ role', async () => {
    const player = { skip: vi.fn(() => true) };
    const message = messageWith(player, { member: fakeMember({ roles: ['Member'] }) });
    await skip.execute(message, []);
    expect(player.skip).not.toHaveBeenCalled();
    expect(message.channel.send.mock.calls[0][0]).toMatch(/required privleges/);
  });

  it('does not need the requester in voice', async () => {
    const player = { skip: vi.fn(() => true) };
    const message = messageWith(player, { member: fakeMember({ voiceChannel: null }) });
    await skip.execute(message, []);
    expect(player.skip).toHaveBeenCalled();
  });

  it('needs the bot in voice', async () => {
    const message = messageWith(undefined);
    await skip.execute(message, []);
    expect(message.channel.send).toHaveBeenCalledWith(SKIP_NOT_IN_VOICE);
  });

  it('says when nothing is playing', async () => {
    const message = messageWith({ skip: () => false });
    await skip.execute(message, []);
    expect(message.channel.send).toHaveBeenCalledWith(NOTHING_PLAYING);
  });

  it('skips silently; the next Now Playing is the reply', async () => {
    const player = { skip: vi.fn(() => true) };
    const message = messageWith(player);
    await skip.execute(message, []);
    expect(player.skip).toHaveBeenCalled();
    expect(message.channel.send).not.toHaveBeenCalled();
  });
});

describe('!queue', () => {
  it('works for everyone, in any channel', async () => {
    const message = messageWith(undefined, {
      member: fakeMember({ roles: [], voiceChannel: null }),
      channel: fakeTextChannel({ name: 'general' }),
    });
    await queue.execute(message, []);
    expect(message.channel.send).toHaveBeenCalledWith(QUEUE_EMPTY);
  });

  it.each([[undefined], [{ queue: [] }]])('says the queue is empty (%j)', async (player) => {
    const message = messageWith(player);
    await queue.execute(message, []);
    expect(message.channel.send).toHaveBeenCalledWith(QUEUE_EMPTY);
  });

  it('lists the first 10 upcoming songs and the total', async () => {
    const songs = Array.from({ length: 12 }, (_, index) => fakeSong(`Song ${index + 1}`));
    songs[1].duration = null;
    const message = messageWith({ queue: songs });
    await queue.execute(message, []);

    const embed = message.channel.send.mock.calls[0][0].embeds[0].data;
    const lines = embed.description.split('\n');
    expect(embed.title).toBe('🎶 Current Queue');
    expect(embed.footer.text).toBe('Total in queue: 12');
    expect(lines).toHaveLength(10);
    expect(lines[0]).toBe('**1.** Song 1 `[3:33]` – *billyfan*');
    expect(lines[1]).toBe('**2.** Song 2 – *billyfan*');
  });

  const descriptionOf = (message) => message.channel.send.mock.calls[0][0].embeds[0].data;

  it('shows the playing song and how far into it, above the queue', async () => {
    const message = messageWith({
      nowPlaying: { song: fakeSong('Wilderness'), elapsedMs: 84_900 },
      queue: [fakeSong('Pisces'), fakeSong('One More Time')],
    });
    await queue.execute(message, []);

    const embed = descriptionOf(message);
    expect(embed.description).toBe(
      '▶️ Now playing: Wilderness `[1:24 / 3:33]` – *billyfan*\n\n' +
        '**1.** Pisces `[3:33]` – *billyfan*\n' +
        '**2.** One More Time `[3:33]` – *billyfan*',
    );
    expect(embed.footer.text).toBe('Total in queue: 2');
  });

  it('shows the playing song even when nothing is queued after it', async () => {
    const message = messageWith({
      nowPlaying: { song: fakeSong('Wilderness'), elapsedMs: 0 },
      queue: [],
    });
    await queue.execute(message, []);

    const embed = descriptionOf(message);
    expect(embed.description).toBe(
      '▶️ Now playing: Wilderness `[0:00 / 3:33]` – *billyfan*\n\nNothing queued.',
    );
    expect(embed.footer.text).toBe('Total in queue: 0');
  });

  it('lists the queue alone between songs', async () => {
    const message = messageWith({ nowPlaying: null, queue: [fakeSong('Pisces')] });
    await queue.execute(message, []);
    expect(descriptionOf(message).description).toBe('**1.** Pisces `[3:33]` – *billyfan*');
  });

  it('shows only the time played for a livestream', async () => {
    const message = messageWith({
      nowPlaying: { song: { ...fakeSong('Lofi Radio'), duration: null }, elapsedMs: 3_725_000 },
      queue: [],
    });
    await queue.execute(message, []);
    expect(descriptionOf(message).description).toMatch(/^▶️ Now playing: Lofi Radio `\[1:02:05\]`/);
  });

  it('never shows more time played than the song is long', async () => {
    const message = messageWith({
      nowPlaying: { song: fakeSong('Wilderness'), elapsedMs: 999_000 },
      queue: [],
    });
    await queue.execute(message, []);
    expect(descriptionOf(message).description).toContain('`[3:33 / 3:33]`');
  });
});

describe('!leave', () => {
  const admin = () => fakeMember({ manageServer: true, roles: [] });

  it('leaves without a reply for a member with Manage Server, from any channel', async () => {
    const player = { destroy: vi.fn() };
    const message = messageWith(player, {
      member: admin(),
      channel: fakeTextChannel({ name: 'general' }),
    });
    await leave.execute(message, []);
    expect(player.destroy).toHaveBeenCalled();
    expect(message.channel.send).not.toHaveBeenCalled();
  });

  it('leaves for the server owner', async () => {
    const player = { destroy: vi.fn() };
    const message = messageWith(player, { member: fakeMember({ id: OWNER_ID }) });
    await leave.execute(message, []);
    expect(player.destroy).toHaveBeenCalled();
  });

  it('refuses everyone else, DJs included', async () => {
    const player = { destroy: vi.fn() };
    const message = messageWith(player);
    await leave.execute(message, []);
    expect(player.destroy).not.toHaveBeenCalled();
    expect(message.channel.send).toHaveBeenCalledWith(NOT_ADMIN_LEAVE);
  });

  it('does nothing when the bot is not in voice', async () => {
    const message = messageWith(undefined, { member: admin() });
    await expect(leave.execute(message, [])).resolves.toBeUndefined();
    expect(message.channel.send).not.toHaveBeenCalled();
  });
});
