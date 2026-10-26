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
