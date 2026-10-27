import { Client, GatewayIntentBits, Partials } from 'discord.js';

export function createClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      // Who is in which voice channel: the requester's channel, and whether the bot is alone.
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      // Privileged: message text in server channels, for the prefix commands (DM text is
      // delivered without it).
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    // DM channels are not cached until used; without this partial, DM messageCreate never fires.
    partials: [Partials.Channel],
  });
}
