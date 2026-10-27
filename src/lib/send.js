import { logger } from './logger.js';

// Sends a message to a channel or user. If Discord refuses it (closed DMs, missing permissions, a
// deleted channel) the error is logged instead of thrown, because an unhandled rejection would
// stop the bot. Returns the sent message, or null if it could not be sent.
export async function send(target, options) {
  try {
    return await target.send(options);
  } catch (error) {
    logger.warn({ err: error, targetId: target.id }, 'Could not send a message');
    return null;
  }
}

// Edits a message the bot sent. Like send(), logs instead of throwing (e.g. someone deleted the
// message). Returns the edited message, or null if it could not be edited.
export async function edit(message, options) {
  try {
    return await message.edit(options);
  } catch (error) {
    logger.warn({ err: error, messageId: message.id }, 'Could not edit a message');
    return null;
  }
}

// Deletes a message the bot sent, logging instead of throwing.
export async function remove(message) {
  try {
    await message.delete();
  } catch (error) {
    logger.warn({ err: error, messageId: message.id }, 'Could not delete a message');
  }
}

// Turns `message` (a status card such as "Searching…") into `options`: a text reply or
// { embeds }. Sends `options` to `channel` instead if there is no message or it cannot be edited.
export async function editOrSend(message, channel, options) {
  if (message) {
    const edited = await edit(
      message,
      typeof options === 'string' ? { content: options, embeds: [] } : options,
    );
    if (edited) return edited;
  }
  return send(channel, options);
}
