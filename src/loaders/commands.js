import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Collection } from 'discord.js';
import { findModuleFiles } from './files.js';

const COMMANDS_DIR = path.join(import.meta.dirname, '..', 'commands');

// Every module under src/commands/ default-exports a prefix command:
//
//   {
//     name,      // what follows the prefix, e.g. 'play' for !play (case-sensitive)
//     execute,   // async (message, args) => {}; args are the words after the command
//   }
//
// Commands only run in servers; DMs are handled by handlers/directMessage.js. Reply with send()
// from lib/send.js, so a reply Discord refuses is logged instead of thrown.

export function isCommand(value) {
  return typeof value?.name === 'string' && typeof value.execute === 'function';
}

// Imports every command module under src/commands/ into a Collection keyed by command name.
// Throws on invalid or duplicate commands.
export async function loadCommands(directory = COMMANDS_DIR) {
  const commands = new Collection();

  for (const filePath of await findModuleFiles(directory)) {
    const { default: command } = await import(pathToFileURL(filePath).href);
    if (!isCommand(command)) {
      throw new Error(`${filePath} must default-export a command with "name" and "execute"`);
    }
    if (commands.has(command.name)) {
      throw new Error(`Duplicate command name "${command.name}" in ${filePath}`);
    }
    commands.set(command.name, command);
  }

  return commands;
}
