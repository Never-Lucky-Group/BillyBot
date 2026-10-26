import { EventEmitter } from 'node:events';
import { AudioPlayerStatus, VoiceConnectionStatus } from '@discordjs/voice';
import { Collection } from 'discord.js';
import { vi } from 'vitest';

// Minimal stand-ins for discord.js and @discordjs/voice objects: only what the bot's code reads.

export const GUILD_ID = '100000000000000001';
export const VOICE_CHANNEL_ID = '200000000000000001';
export const TEXT_CHANNEL_ID = '200000000000000002';
export const USER_ID = '300000000000000001';
export const BOT_USER_ID = '300000000000000099';

export const flush = () => new Promise((resolve) => setImmediate(resolve));

export function fakeTextChannel({ name = 'music_bot' } = {}) {
  return { id: TEXT_CHANNEL_ID, name, send: vi.fn(() => Promise.resolve({})) };
}

export function fakeGuild({ voiceStates = [] } = {}) {
  return {
    id: GUILD_ID,
    members: { me: { id: BOT_USER_ID } },
    voiceAdapterCreator: () => ({}),
    voiceStates: { cache: new Collection(voiceStates.map((state) => [state.id, state])) },
    client: { user: { id: BOT_USER_ID } },
  };
}

export function fakeVoiceChannel({ guild = fakeGuild(), canSpeak = true } = {}) {
  return {
    id: VOICE_CHANNEL_ID,
    guild,
    permissionsFor: vi.fn(() => ({ has: () => canSpeak })),
  };
}

// A song as commands/play.js queues it.
export function fakeSong(title = 'Song') {
  return {
    title,
    thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    duration: 213,
    url: 'https://youtu.be/dQw4w9WgXcQ',
    videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    requestedBy: 'billyfan',
  };
}

// Behaves like @discordjs/voice's AudioPlayer: emits 'stateChange', and the new status as an
// event when the status changes.
export class FakeAudioPlayer extends EventEmitter {
  state = { status: AudioPlayerStatus.Idle };

  play = vi.fn((resource) => this.setState({ status: AudioPlayerStatus.Buffering, resource }));

  stop = vi.fn(() => {
    if (this.state.status === AudioPlayerStatus.Idle) return false;
    this.setState({ status: AudioPlayerStatus.Idle });
    return true;
  });

  setState(newState) {
    const oldState = this.state;
    this.state = newState;
    this.emit('stateChange', oldState, newState);
    if (oldState.status !== newState.status) this.emit(newState.status, oldState, newState);
  }

  // The resource started sending audio.
  startPlaying() {
    this.setState({ status: AudioPlayerStatus.Playing, resource: this.state.resource });
  }

  // The resource ran out (the song ended or its stream failed).
  finish() {
    this.setState({ status: AudioPlayerStatus.Idle });
  }
}

export class FakeVoiceConnection extends EventEmitter {
  state = { status: VoiceConnectionStatus.Signalling };
  joinConfig = { channelId: VOICE_CHANNEL_ID };
  subscribe = vi.fn();
  destroy = vi.fn(() => this.setStatus(VoiceConnectionStatus.Destroyed));

  setStatus(status) {
    const oldState = this.state;
    this.state = { status };
    this.emit('stateChange', oldState, this.state);
    this.emit(status, oldState, this.state);
  }
}

// The @discordjs/voice functions GuildPlayer uses. `entersState` resolves by default, i.e. the
// connection becomes ready; make it reject to simulate a failed join.
export function fakeVoice() {
  const player = new FakeAudioPlayer();
  const connection = new FakeVoiceConnection();
  return {
    player,
    connection,
    createAudioPlayer: vi.fn(() => player),
    createAudioResource: vi.fn((stream, { metadata }) => ({
      stream,
      metadata,
      playbackDuration: 0,
    })),
    joinVoiceChannel: vi.fn(() => connection),
    entersState: vi.fn(() => Promise.resolve()),
  };
}

// createMedia()'s interface. Each opened stream is recorded; `audio.onError` is the handler the
// player set, so a test calls it to simulate yt-dlp or ffmpeg failing.
export function fakeMedia() {
  const streams = [];
  return {
    streams,
    fetchSongInfo: vi.fn(() => Promise.resolve({ title: 'Song', thumbnail: null, duration: 213 })),
    openAudioStream: vi.fn((videoUrl) => {
      const audio = {
        videoUrl,
        stream: { videoUrl },
        stop: vi.fn(),
        onError: null,
        setErrorHandler: vi.fn((handler) => {
          audio.onError = handler;
        }),
      };
      streams.push(audio);
      return audio;
    }),
    checkTools: vi.fn(() => Promise.resolve()),
  };
}

export function fakeMember({ roles = ['DJ'], voiceChannel = fakeVoiceChannel() } = {}) {
  return {
    voice: { channel: voiceChannel },
    roles: { cache: new Collection(roles.map((name, index) => [String(index), { name }])) },
  };
}

// A server message. `client` holds what index.js attaches: settings, commands, media, players.
export function fakeGuildMessage({
  content = '!play',
  member = fakeMember(),
  channel,
  client = {},
}) {
  return {
    content,
    channel: channel ?? fakeTextChannel(),
    member,
    guild: member.voice.channel?.guild ?? fakeGuild(),
    author: {
      id: USER_ID,
      username: 'billyfan',
      bot: false,
      toString: () => `<@${USER_ID}>`,
      send: vi.fn(() => Promise.resolve({})),
    },
    client: { settings: { prefix: '!' }, ...client },
    inGuild: () => true,
  };
}
