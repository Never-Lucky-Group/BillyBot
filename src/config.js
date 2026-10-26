import { readFile } from 'node:fs/promises';
import { z } from 'zod';

// Thrown when environment variables or easter-eggs.json are missing or invalid.
export class ConfigError extends Error {
  name = 'ConfigError';
}

const snowflake = z.string().regex(/^\d{17,20}$/, 'Expected a Discord ID (17-20 digits)');

// Treats `KEY=` (empty value in .env) the same as an unset variable so defaults apply.
const optionalEnv = (schema) => z.preprocess((value) => (value === '' ? undefined : value), schema);

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  PREFIX: optionalEnv(z.string().regex(/^\S+$/, 'PREFIX must not contain spaces').default('!')),
  LOG_LEVEL: optionalEnv(
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ),
  EASTER_EGGS_PATH: optionalEnv(z.string().default('easter-eggs.json')),
  YTDLP_PATH: optionalEnv(z.string().default('yt-dlp')),
  FFMPEG_PATH: optionalEnv(z.string().default('ffmpeg')),
});

// Returns { token, prefix, logLevel, easterEggsPath, ytdlpPath, ffmpegPath }.
export function loadEnv(source = process.env) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new ConfigError(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return {
    token: result.data.DISCORD_TOKEN,
    prefix: result.data.PREFIX,
    logLevel: result.data.LOG_LEVEL,
    easterEggsPath: result.data.EASTER_EGGS_PATH,
    ytdlpPath: result.data.YTDLP_PATH,
    ffmpegPath: result.data.FFMPEG_PATH,
  };
}

// DM keywords the bot already answers; an easter egg with one of these would never be reached.
const RESERVED_KEYWORDS = new Set(['help', 'patchnotes', 'i love you']);

// A DM matching `keyword` (ignoring case) gets `reply` from the user with `userId` and
// `otherReply` from anyone else.
const easterEggSchema = z.strictObject({
  keyword: z
    .string()
    .trim()
    .min(1)
    .transform((keyword) => keyword.toLowerCase())
    .refine((keyword) => !RESERVED_KEYWORDS.has(keyword), {
      message: 'Keyword is already a DM command (help, patchnotes, i love you)',
    }),
  userId: snowflake,
  reply: z.string().min(1),
  otherReply: z.string().min(1),
});

const easterEggsFileSchema = z
  .array(easterEggSchema)
  .refine((eggs) => new Set(eggs.map((egg) => egg.keyword)).size === eggs.length, {
    message: 'Keywords must be unique',
  });

// Returns a Map of lowercase keyword → { keyword, userId, reply, otherReply }.
export function parseEasterEggs(raw) {
  const result = easterEggsFileSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(`Invalid easter eggs:\n${z.prettifyError(result.error)}`);
  }
  return new Map(result.data.map((egg) => [egg.keyword, egg]));
}

// Easter eggs are optional: returns null when the file does not exist. A file that exists but is
// invalid stops the bot, like invalid environment variables.
export async function loadEasterEggs(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new ConfigError(`Could not read easter eggs at "${path}".`, { cause: error });
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`Easter eggs at "${path}" are not valid JSON.`, { cause: error });
  }

  return parseEasterEggs(raw);
}
