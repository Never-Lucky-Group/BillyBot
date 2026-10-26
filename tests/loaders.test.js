import { describe, expect, it } from 'vitest';
import { isCommand, loadCommands } from '../src/loaders/commands.js';

describe('loadCommands', () => {
  it('loads every command in src/commands', async () => {
    const commands = await loadCommands();
    expect([...commands.keys()].sort()).toEqual([
      'help',
      'leave',
      'patchnotes',
      'play',
      'queue',
      'skip',
    ]);
    for (const command of commands.values()) expect(isCommand(command)).toBe(true);
  });
});
