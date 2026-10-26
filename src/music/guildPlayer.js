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

const VOICE_PERMISSIONS = PermissionFlagsBits.Connect | PermissionFlagsBits.Speak;

const defaultVoice = { createAudioPlayer, createAudioResource, entersState, joinVoiceChannel };

// The music for one server: its queue, the song playing, and the bot's voice connection. Created by
// PlayerRegistry when someone queues a song, and destroyed when the bot leaves (!leave, alone in
// the channel, kicked, or a failed join). A destroyed player is never reused.
//
// Songs play one at a time, in order. Starting a song is serialised, so songs queued while the
// bot is still joining wait their turn instead of interrupting each other.
export class GuildPlayer {
  // Upcoming songs, not counting the one playing.
  queue = [];
  // { song, audio } for the song playing or about to play, or null.
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
      this.#announce(newState.resource.metadata),
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

  // Adds a song to the end of the queue. Returns true if it starts right away, false if it waits
  // behind other songs. A destroyed player drops the song (and returns true, since there is
  // nothing it waits behind); the reason it was destroyed has already been sent.
  enqueue(song) {
    if (this.#destroyed) return true;
    const startsNow = !this.current && !this.#starting && this.queue.length === 0;
    this.queue.push(song);
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

      entry = { song, audio: null, failed: false };
      entry.audio = this.#media.openAudioStream(song.videoUrl, {
        onError: (error) => this.#fail(entry, error),
      });
      const resource = this.#voice.createAudioResource(entry.audio.stream, {
        inputType: StreamType.OggOpus,
        metadata: entry,
      });
      this.current = entry;
      this.#player.play(resource);
      logger.info({ guildId: this.guildId, title: song.title }, 'Starting song');
    } catch (error) {
      logger.error({ err: error, guildId: this.guildId }, 'Could not start a song');
      void send(this.#textChannel, DOWNLOAD_FAILED);
      entry?.audio?.stop();
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

  #announce(entry) {
    if (!entry || entry !== this.current || entry === this.#announced) return;
    this.#announced = entry;
    void send(this.#textChannel, { embeds: [nowPlayingEmbed(entry.song)] });
  }

  #finish(resource) {
    const entry = resource?.metadata;
    if (!entry || entry !== this.current) return;
    this.current = null;
    entry.audio.stop();
    void this.#playNext();
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
