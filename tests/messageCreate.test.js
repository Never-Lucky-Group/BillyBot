import { Collection } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import messageCreate from '../src/events/messageCreate.js';
import { parseEasterEggs } from '../src/config.js';
import { DM_NOT_UNDERSTOOD, PATCH_NOTES } from '../src/lib/replies.js';
import { USER_ID, fakeGuildMessage } from './helpers/fakes.js';

const EASTER_EGGS = parseEasterEggs([
  { keyword: 'billy', userId: USER_ID, reply: 'Hi Billy.', otherReply: 'You are not Billy.' },
]);

function fakeCommands(...names) {
  return new Collection(names.map((name) => [name, { name, execute: vi.fn() }]));
}

function guildMessage(content) {
  return fakeGuildMessage({ content, client: { commands: fakeCommands('play', 'skip') } });
}

function directMessage(content, { authorId = USER_ID, easterEggs = EASTER_EGGS } = {}) {
  const message = fakeGuildMessage({
    content,
    client: { commands: fakeCommands('play'), easterEggs },
  });
  message.author.id = authorId;
  message.inGuild = () => false;
  message.guild = null;
  message.member = null;
  return message;
}

describe('server messages', () => {
  it('runs the command with the words after it', async () => {
    const message = guildMessage('!play  https://youtu.be/dQw4w9WgXcQ  now ');
    await messageCreate.execute(message);
    expect(message.client.commands.get('play').execute).toHaveBeenCalledWith(message, [
      'https://youtu.be/dQw4w9WgXcQ',
      'now',
    ]);
  });

  it('runs a command on its own line', async () => {
    const message = guildMessage('!skip');
    await messageCreate.execute(message);
    expect(message.client.commands.get('skip').execute).toHaveBeenCalledWith(message, []);
  });

  it.each(['!playlist', '!skipped', '! play', '!Play', 'play', 'hello !play', '!', '!unknown'])(
    'runs nothing for %j',
    async (content) => {
      const message = guildMessage(content);
      await messageCreate.execute(message);
      for (const command of message.client.commands.values()) {
        expect(command.execute).not.toHaveBeenCalled();
      }
    },
  );

  it('ignores bots', async () => {
    const message = guildMessage('!play');
    message.author.bot = true;
    await messageCreate.execute(message);
    expect(message.client.commands.get('play').execute).not.toHaveBeenCalled();
  });
});

describe('direct messages', () => {
  it.each([
    ['help', 'Global commands:\n!help , !patchnotes , !leave , !play [youtube url], !skip, !queue'],
    ['HELP', 'Global commands:\n!help , !patchnotes , !leave , !play [youtube url], !skip, !queue'],
    ['patchnotes', PATCH_NOTES],
    ['i love you', 'I love you too billyfan'],
    ['hello', DM_NOT_UNDERSTOOD],
    ['', DM_NOT_UNDERSTOOD],
  ])('answers %j', async (content, reply) => {
    const message = directMessage(content);
    await messageCreate.execute(message);
    expect(message.author.send).toHaveBeenCalledWith(reply);
  });

  it('answers prefix commands without running them (they used to crash the bot)', async () => {
    const message = directMessage('!play https://youtu.be/dQw4w9WgXcQ');
    await messageCreate.execute(message);
    expect(message.author.send).toHaveBeenCalledWith(DM_NOT_UNDERSTOOD);
    expect(message.client.commands.get('play').execute).not.toHaveBeenCalled();
  });

  it('gives the easter egg reply to its user', async () => {
    const message = directMessage('Billy');
    await messageCreate.execute(message);
    expect(message.author.send).toHaveBeenCalledWith('Hi Billy.');
  });

  it('gives the other reply to anyone else', async () => {
    const message = directMessage('billy', { authorId: '399999999999999999' });
    await messageCreate.execute(message);
    expect(message.author.send).toHaveBeenCalledWith('You are not Billy.');
  });

  it('treats easter egg keywords as ordinary words without an easter eggs file', async () => {
    const message = directMessage('billy', { easterEggs: null });
    await messageCreate.execute(message);
    expect(message.author.send).toHaveBeenCalledWith(DM_NOT_UNDERSTOOD);
  });
});
