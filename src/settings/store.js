import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ConfigError, snowflake } from '../config.js';

// One server's !setup choices. A null ID means the default (see music/access.js).
const guildSettingsSchema = z.strictObject({
  musicChannelId: snowflake.nullable(),
  djRoleId: snowflake.nullable(),
  updatedBy: snowflake,
  updatedAt: z.number().int(), // Unix seconds
});

// The file: guild ID → that server's settings.
const fileSchema = z.record(snowflake, guildSettingsSchema);

const NO_SETTINGS = Object.freeze({ musicChannelId: null, djRoleId: null });

// Each server's !setup choices, kept in a JSON file. A server without an entry uses the defaults.
// The file is read once at startup and rewritten on every change: written to a temporary file
// first and then renamed over the old one, so a crash while saving never leaves it half-written.
export class SettingsStore {
  #filePath;
  #guilds;
  // Saves run one after another, so an older save never overwrites a newer one.
  #saving = Promise.resolve();

  constructor(filePath, guilds = new Map()) {
    this.#filePath = filePath;
    this.#guilds = guilds;
  }

  // Reads the file; a missing file means no server has run !setup yet. A file that cannot be read
  // or is invalid stops the bot instead of being overwritten.
  static async load(filePath) {
    let text;
    try {
      text = await readFile(filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return new SettingsStore(filePath);
      throw new ConfigError(`Could not read the settings at "${filePath}".`, { cause: error });
    }

    let raw;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      throw new ConfigError(`The settings at "${filePath}" are not valid JSON.`, { cause: error });
    }
    const result = fileSchema.safeParse(raw);
    if (!result.success) {
      throw new ConfigError(`Invalid settings at "${filePath}":\n${z.prettifyError(result.error)}`);
    }
    return new SettingsStore(filePath, new Map(Object.entries(result.data)));
  }

  get size() {
    return this.#guilds.size;
  }

  // Returns { musicChannelId, djRoleId }; both null for a server that has not run !setup.
  get(guildId) {
    const settings = this.#guilds.get(guildId);
    if (!settings) return NO_SETTINGS;
    return { musicChannelId: settings.musicChannelId, djRoleId: settings.djRoleId };
  }

  // Replaces a server's settings and saves the file. Null for both removes the server's entry,
  // back to the defaults. If saving fails, the old settings are kept and the error is thrown.
  async set(guildId, { musicChannelId, djRoleId }, userId, now = Math.floor(Date.now() / 1000)) {
    const previous = this.#guilds.get(guildId);
    if (musicChannelId === null && djRoleId === null) {
      this.#guilds.delete(guildId);
    } else {
      this.#guilds.set(guildId, { musicChannelId, djRoleId, updatedBy: userId, updatedAt: now });
    }
    try {
      await this.#save();
    } catch (error) {
      if (previous) this.#guilds.set(guildId, previous);
      else this.#guilds.delete(guildId);
      throw error;
    }
  }

  #save() {
    const text = `${JSON.stringify(Object.fromEntries(this.#guilds), null, 2)}\n`;
    const run = this.#saving.then(async () => {
      await mkdir(path.dirname(this.#filePath), { recursive: true });
      const temporary = `${this.#filePath}.tmp`;
      await writeFile(temporary, text);
      await rename(temporary, this.#filePath);
    });
    // A failed save must not stop the ones after it.
    this.#saving = run.catch(() => {});
    return run;
  }
}
