import { DM_NOT_UNDERSTOOD, PATCH_NOTES, helpText, loveReply } from '../lib/replies.js';
import { send } from '../lib/send.js';

// Answers a DM to the bot. DMs are matched as a whole, ignoring case; prefix commands do not work
// in DMs.
export async function handleDirectMessage(message) {
  await send(message.author, directMessageReply(message));
}

export function directMessageReply(message) {
  const { easterEggs, settings } = message.client;
  const text = message.content.toLowerCase();

  if (text === 'help') return helpText(settings.prefix);
  if (text === 'patchnotes') return PATCH_NOTES;

  // From easter-eggs.json (see config.js); null when the file does not exist.
  const egg = easterEggs?.get(text);
  if (egg) return message.author.id === egg.userId ? egg.reply : egg.otherReply;

  if (text === 'i love you') return loveReply(message.author.username);
  return DM_NOT_UNDERSTOOD;
}
