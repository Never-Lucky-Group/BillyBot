import { GuildPlayer } from './guildPlayer.js';

// The GuildPlayer of every server the bot is playing music in, by guild ID.
export class PlayerRegistry {
  #players = new Map();
  // Guild ID → how many times the bot has left voice there. See leaveCount().
  #leaves = new Map();
  #media;
  #createPlayer;

  constructor({ media, createPlayer = (options) => new GuildPlayer(options) }) {
    this.#media = media;
    this.#createPlayer = createPlayer;
  }

  get(guildId) {
    return this.#players.get(guildId);
  }

  // Returns the server's player, creating one for these channels if the bot is not playing there.
  getOrCreate({ voiceChannel, textChannel }) {
    const guildId = voiceChannel.guild.id;
    let player = this.#players.get(guildId);
    if (!player) {
      player = this.#createPlayer({
        voiceChannel,
        textChannel,
        media: this.#media,
        onDestroy: (destroyed) => this.#remove(guildId, destroyed),
      });
      this.#players.set(guildId, player);
    }
    return player;
  }

  // Changes every time the bot leaves voice in the server. !play notes it before looking up a song
  // and drops the song if it changed meanwhile, so a !leave is not undone by a request that was
  // still loading.
  leaveCount(guildId) {
    return this.#leaves.get(guildId) ?? 0;
  }

  destroyAll() {
    for (const player of [...this.#players.values()]) player.destroy();
  }

  #remove(guildId, player) {
    if (this.#players.get(guildId) === player) this.#players.delete(guildId);
    this.#leaves.set(guildId, this.leaveCount(guildId) + 1);
  }
}
