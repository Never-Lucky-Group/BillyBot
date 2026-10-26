import { describe, expect, it, vi } from 'vitest';
import help from '../src/commands/help.js';
import leave from '../src/commands/leave.js';
import patchnotes from '../src/commands/patchnotes.js';
import queue from '../src/commands/queue.js';
import skip from '../src/commands/skip.js';
import {
  NOTHING_PLAYING,
  PATCH_NOTES,
  QUEUE_EMPTY,
  SKIP_NOT_IN_VOICE,
} from '../src/lib/replies.js';
import { fakeGuildMessage, fakeSong } from './helpers/fakes.js';

function messageWith(player) {
  return fakeGuildMessage({
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
});

describe('!leave', () => {
  it('leaves without a reply', async () => {
    const player = { destroy: vi.fn() };
    const message = messageWith(player);
    await leave.execute(message, []);
    expect(player.destroy).toHaveBeenCalled();
    expect(message.channel.send).not.toHaveBeenCalled();
  });

  it('does nothing when the bot is not in voice', async () => {
    const message = messageWith(undefined);
    await expect(leave.execute(message, [])).resolves.toBeUndefined();
    expect(message.channel.send).not.toHaveBeenCalled();
  });
});
