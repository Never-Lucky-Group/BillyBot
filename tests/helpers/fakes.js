import { EventEmitter } from 'node:events';
import { AudioPlayerStatus, VoiceConnectionStatus } from '@discordjs/voice';
import { Collection } from 'discord.js';
import { vi } from 'vitest';
import { SettingsStore } from '../../src/settings/store.js';

// Minimal stand-ins for discord.js and @discordjs/voice objects: only what the bot's code reads.

export const GUILD_ID = '100000000000000001';
export const VOICE_CHANNEL_ID = '200000000000000001';
export const TEXT_CHANNEL_ID = '200000000000000002';
export const USER_ID = '300000000000000001';
export const BOT_USER_ID = '300000000000000099';
export const OWNER_ID = '300000000000000777';

export const flush = () => new Promise((resolve) => setImmediate(resolve));

// A message the bot sent. Its edit() and delete() calls are recorded.
export function fakeSentMessage() {
  const message = {
    id: '400000000000000001',
    edit: vi.fn(() => Promise.resolve(message)),
    delete: vi.fn(() => Promise.resolve()),
  };
  return message;
}

export function fakeTextChannel({ name = 'music_bot', id = TEXT_CHANNEL_ID } = {}) {
  return { id, name, send: vi.fn(() => Promise.resolve(fakeSentMessage())) };
}

// `channels` and `roles` are what the server's caches hold, e.g. [{ id, name }].
export function fakeGuild({
  voiceStates = [],
  channels = [],
  roles = [],
  ownerId = OWNER_ID,
} = {}) {
  return {
    id: GUILD_ID,
    ownerId,
    members: { me: { id: BOT_USER_ID } },
    channels: { cache: new Collection(channels.map((channel) => [channel.id, channel])) },
    roles: { cache: new Collection(roles.map((role) => [role.id, role])) },
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

// `roles` are role names, or { id, name } for roles a test refers to by ID. `manageServer` gives the
// member the Manage Server permission.
export function fakeMember({
  id = USER_ID,
  roles = ['DJ'],
  voiceChannel = fakeVoiceChannel(),
  guild = voiceChannel?.guild ?? fakeGuild(),
  manageServer = false,
} = {}) {
  const roleObjects = roles.map((role, index) =>
    typeof role === 'string' ? { id: `5000000000000000${index}`, name: role } : role,
  );
  return {
    id,
    guild,
    voice: { channel: voiceChannel },
    roles: { cache: new Collection(roleObjects.map((role) => [role.id, role])) },
    permissions: { has: vi.fn(() => manageServer) },
  };
}

// A server message. `client` holds what index.js attaches: settings, settingsStore, commands, media,
// players. The settings store is empty (no !setup) unless one is given.
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
    guild: member.guild,
    author: {
      id: USER_ID,
      username: 'billyfan',
      bot: false,
      toString: () => `<@${USER_ID}>`,
      send: vi.fn(() => Promise.resolve({})),
    },
    client: {
      settings: { prefix: '!' },
      settingsStore: new SettingsStore('unused-settings.json'),
      ...client,
    },
    inGuild: () => true,
  };
}
