import { GuildPlayer } from './guildPlayer.js';

// The GuildPlayer of every server the bot is playing music in, by guild ID.
export class PlayerRegistry {
  #players = new Map();
  // Guild ID → how many times the bot has left voice there. See leaveCount().
  #leaves = new Map();
  // Guild IDs where a !play holds the early stream. See claimEarlyStream().
  #earlyStreams = new Set();
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

  // !play opens a song's stream while looking it up when nothing is playing. Only one !play per
  // server may do that at a time, so a burst of requests does not start a stream for each (all but
  // one would be thrown away). Returns false if another !play holds it. Release it with
  // releaseEarlyStream() once the lookup is over.
  claimEarlyStream(guildId) {
    if (this.#earlyStreams.has(guildId)) return false;
    this.#earlyStreams.add(guildId);
    return true;
  }

  releaseEarlyStream(guildId) {
    this.#earlyStreams.delete(guildId);
  }

  // Returns how many players there were.
  destroyAll() {
    const players = [...this.#players.values()];
    for (const player of players) player.destroy();
    return players.length;
  }

  #remove(guildId, player) {
    if (this.#players.get(guildId) === player) this.#players.delete(guildId);
    this.#leaves.set(guildId, this.leaveCount(guildId) + 1);
  }
}
