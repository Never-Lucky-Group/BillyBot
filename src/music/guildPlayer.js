import {
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice';
import { PermissionFlagsBits } from 'discord.js';
import { logger } from '../lib/logger.js';
import { DOWNLOAD_FAILED, NO_VOICE_PERMISSION, VOICE_CONNECT_FAILED } from '../lib/replies.js';
import { send } from '../lib/send.js';
import { nowPlayingEmbed } from './embeds.js';

// How long joining a voice channel may take before it counts as failed.
const CONNECT_TIMEOUT_MS = 20_000;
// After an unexpected disconnect, how long to wait for the connection to start recovering (e.g.
// the bot was moved to another channel) before treating it as kicked and leaving.
const RECONNECT_TIMEOUT_MS = 5_000;
// How long before the playing song ends to open the next song's stream. yt-dlp takes several
// seconds to start, so opening it early lets the next song follow without a gap.
export const PRELOAD_LEAD_MS = 20_000;

const VOICE_PERMISSIONS = PermissionFlagsBits.Connect | PermissionFlagsBits.Speak;

const defaultVoice = { createAudioPlayer, createAudioResource, entersState, joinVoiceChannel };

// The music for one server: its queue, the song playing, and the bot's voice connection. Created by
// PlayerRegistry when someone queues a song, and destroyed when the bot leaves (!leave, alone in
// the channel, kicked, or a failed join). A destroyed player is never reused.
//
// Songs play one at a time, in order. Starting a song is serialised, so songs queued while the
// bot is still joining wait their turn instead of interrupting each other.
//
// The next song's stream is opened ("preloaded") PRELOAD_LEAD_MS before the playing song ends, or
// by !play while it looks up a song that will start right away. A preloaded stream that fails is
// dropped quietly and opened again when its song's turn comes.
export class GuildPlayer {
  // Upcoming songs, not counting the one playing.
  queue = [];
  // The entry ({ song, audio, resource, failed }) for the song playing or about to play, or null.
  current = null;

  #voiceChannel;
  #textChannel;
  #media;
  #onDestroy;
  #voice;
  #player;
  #connection = null;
  #starting = false;
  #destroyed = false;
  #announced = null;
  // The entry for queue[0] whose stream is already open, or null.
  #preloaded = null;
  #preloadTimer = null;
  // Whether the playing song is within PRELOAD_LEAD_MS of its end, so a song queued now is
  // preloaded straight away.
  #preloadDue = false;

  // voiceChannel and textChannel are where the first song was requested; later songs play in the
  // same channels.
  constructor({ voiceChannel, textChannel, media, onDestroy = () => {}, voice = defaultVoice }) {
    this.#voiceChannel = voiceChannel;
    this.#textChannel = textChannel;
    this.#media = media;
    this.#onDestroy = onDestroy;
    this.#voice = voice;

    this.#player = voice.createAudioPlayer();
    this.#player.on(AudioPlayerStatus.Playing, (_oldState, newState) =>
      this.#started(newState.resource),
    );
    this.#player.on(AudioPlayerStatus.Idle, (oldState) => this.#finish(oldState.resource));
    this.#player.on('error', (error) => this.#fail(error.resource?.metadata, error));
  }

  get guildId() {
    return this.#voiceChannel.guild.id;
  }

  // The voice channel the bot is in, or is joining. Follows the bot if it is moved.
  get channelId() {
    return this.#connection?.joinConfig.channelId ?? this.#voiceChannel.id;
  }

  get destroyed() {
    return this.#destroyed;
  }

  // The song playing (or about to play) and how far into it playback is, or null. Paused time,
  // while the connection recovers, does not count.
  get nowPlaying() {
    if (!this.current) return null;
    return { song: this.current.song, elapsedMs: this.current.resource?.playbackDuration ?? 0 };
  }

  // Whether a song queued now would start right away.
  get idle() {
    return !this.#destroyed && !this.current && !this.#starting && this.queue.length === 0;
  }

  // Adds a song to the end of the queue. Returns true if it starts right away, false if it waits
  // behind other songs. `audio` is the song's stream if the caller already opened one (see
  // commands/play.js); it is used if the song starts right away and stopped otherwise.
  //
  // A destroyed player drops the song (and returns true, since there is nothing it waits behind);
  // the reason it was destroyed has already been sent.
  enqueue(song, { audio = null } = {}) {
    const startsNow = this.idle;
    if (this.#destroyed) {
      audio?.stop();
      return true;
    }
    this.queue.push(song);
    if (audio && startsNow) {
      this.#preloaded = this.#createEntry(song, audio);
    } else {
      audio?.stop();
      this.#preload();
    }
    void this.#playNext();
    return startsNow;
  }

  // Ends the song playing; the next one in the queue starts. Returns false if nothing is playing.
  skip() {
    if (!this.current) return false;
    this.#player.stop(true);
    return true;
  }

  // Leaves the voice channel and drops the queue. Safe to call more than once.
  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.queue.length = 0;
    this.#cancelPreload();
    const entry = this.current;
    this.current = null;
    this.#player.stop(true);
    entry?.audio.stop();
    if (this.#connection && this.#connection.state.status !== VoiceConnectionStatus.Destroyed) {
      this.#connection.destroy();
    }
    logger.info({ guildId: this.guildId }, 'Left the voice channel');
    this.#onDestroy(this);
  }

  async #playNext() {
    if (this.#starting || this.current || this.#destroyed || this.queue.length === 0) return;
    this.#starting = true;
    let entry = null;
    try {
      if (!(await this.#connect())) return;
      const song = this.queue.shift();
      if (!song) return;

      const preloaded = this.#preloaded;
      this.#preloaded = null;
      if (preloaded?.song === song) {
        entry = preloaded;
      } else {
        preloaded?.audio.stop();
        entry = this.#createEntry(song, this.#media.openAudioStream(song.videoUrl));
      }
      const resource = this.#voice.createAudioResource(entry.audio.stream, {
        inputType: StreamType.OggOpus,
        metadata: entry,
      });
      entry.resource = resource;
      this.current = entry;
      this.#player.play(resource);
      logger.info(
        { guildId: this.guildId, title: song.title, preloaded: entry === preloaded },
        'Starting song',
      );
    } catch (error) {
      logger.error({ err: error, guildId: this.guildId }, 'Could not start a song');
      void send(this.#textChannel, DOWNLOAD_FAILED);
      entry?.audio.stop();
      this.current = null;
    } finally {
      this.#starting = false;
    }
    // Moves on if the song could not start (the queue may also have grown while joining).
    if (!this.current) void this.#playNext();
  }

  // Joins the voice channel the first time a song plays. Returns false, after telling the channel
  // why and destroying this player, if the bot cannot join.
  async #connect() {
    if (this.#connection) return true;

    const me = this.#voiceChannel.guild.members.me;
    if (!this.#voiceChannel.permissionsFor(me)?.has(VOICE_PERMISSIONS)) {
      logger.warn({ guildId: this.guildId }, 'Missing permission to join or speak in voice');
      void send(this.#textChannel, NO_VOICE_PERMISSION);
      this.destroy();
      return false;
    }

    const connection = this.#voice.joinVoiceChannel({
      channelId: this.#voiceChannel.id,
      guildId: this.guildId,
      adapterCreator: this.#voiceChannel.guild.voiceAdapterCreator,
    });
    this.#connection = connection;
    connection.on('stateChange', (oldState, newState) =>
      logger.debug(
        { guildId: this.guildId, from: oldState.status, to: newState.status },
        'Voice connection state',
      ),
    );
    connection.on('error', (error) =>
      logger.error({ err: error, guildId: this.guildId }, 'Voice connection error'),
    );
    connection.on(VoiceConnectionStatus.Disconnected, () => void this.#recover(connection));
    // Also covers anything else destroying the connection.
    connection.on(VoiceConnectionStatus.Destroyed, () => this.destroy());
    connection.subscribe(this.#player);

    try {
      await this.#voice.entersState(connection, VoiceConnectionStatus.Ready, CONNECT_TIMEOUT_MS);
    } catch (error) {
      if (this.#destroyed) return false;
      logger.warn({ err: error, guildId: this.guildId }, 'Could not join the voice channel');
      void send(this.#textChannel, VOICE_CONNECT_FAILED);
      this.destroy();
      return false;
    }
    return !this.#destroyed;
  }

  // A disconnect is either temporary (moved to another channel, a network blip), and the
  // connection starts reconnecting by itself, or the bot was kicked or the channel deleted.
  async #recover(connection) {
    try {
      await Promise.race([
        this.#voice.entersState(connection, VoiceConnectionStatus.Signalling, RECONNECT_TIMEOUT_MS),
        this.#voice.entersState(connection, VoiceConnectionStatus.Connecting, RECONNECT_TIMEOUT_MS),
      ]);
    } catch {
      logger.info({ guildId: this.guildId }, 'Disconnected from voice');
      this.destroy();
    }
  }

  #createEntry(song, audio) {
    const entry = { song, audio, resource: null, failed: false };
    audio.setErrorHandler((error) => this.#streamFailed(entry, error));
    return entry;
  }

  // The first time a song's audio starts: announces it and schedules preloading the next song.
  // Later Playing events for the same song (after a pause while the connection recovered) do
  // nothing.
  #started(resource) {
    const entry = resource.metadata;
    if (!entry || entry !== this.current || entry === this.#announced) return;
    this.#announced = entry;
    void send(this.#textChannel, { embeds: [nowPlayingEmbed(entry.song)] });

    this.#clearPreloadTimer();
    // A livestream has no length, so the next song is opened only when its turn comes.
    const durationMs = Number(entry.song.duration) * 1000;
    if (!(durationMs > 0)) return;
    const delay = Math.max(0, durationMs - resource.playbackDuration - PRELOAD_LEAD_MS);
    this.#preloadTimer = setTimeout(() => {
      this.#preloadDue = true;
      this.#preload();
    }, delay);
  }

  // Opens queue[0]'s stream if the playing song is near its end and it is not open yet.
  #preload() {
    if (!this.#preloadDue || this.#preloaded || this.#destroyed) return;
    const song = this.queue[0];
    if (!song) return;
    try {
      this.#preloaded = this.#createEntry(song, this.#media.openAudioStream(song.videoUrl));
      logger.debug({ guildId: this.guildId, title: song.title }, 'Preloading the next song');
    } catch (error) {
      // Tried again when the song's turn comes.
      logger.warn({ err: error, guildId: this.guildId }, 'Could not preload the next song');
    }
  }

  #clearPreloadTimer() {
    clearTimeout(this.#preloadTimer);
    this.#preloadTimer = null;
    this.#preloadDue = false;
  }

  // Also stops any preloaded stream.
  #cancelPreload() {
    this.#clearPreloadTimer();
    this.#preloaded?.audio.stop();
    this.#preloaded = null;
  }

  #finish(resource) {
    const entry = resource?.metadata;
    if (!entry || entry !== this.current) return;
    this.current = null;
    entry.audio.stop();
    // Keeps the preloaded stream for the song about to start.
    this.#clearPreloadTimer();
    void this.#playNext();
  }

  #streamFailed(entry, error) {
    if (entry === this.#preloaded) {
      logger.warn(
        { err: error, guildId: this.guildId, title: entry.song.title },
        'Preloaded stream failed; it is opened again when the song starts',
      );
      entry.audio.stop();
      this.#preloaded = null;
      return;
    }
    this.#fail(entry, error);
  }

  // Reports a song that failed to stream, once. The player then goes idle and the next song starts.
  #fail(entry, error) {
    if (!entry || entry.failed || this.#destroyed) return;
    entry.failed = true;
    logger.error(
      { err: error, guildId: this.guildId, title: entry.song.title },
      'Song failed to play',
    );
    void send(this.#textChannel, DOWNLOAD_FAILED);
  }
}
