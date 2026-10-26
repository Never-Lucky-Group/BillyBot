import { describe, expect, it, vi } from 'vitest';
import play from '../src/commands/play.js';
import {
  DOWNLOAD_FAILED,
  NOT_IN_VOICE,
  SPOTIFY_UNSUPPORTED,
  UNSUPPORTED_LINK,
} from '../src/lib/replies.js';
import { PlayerRegistry } from '../src/music/players.js';
import {
  fakeGuildMessage,
  fakeMedia,
  fakeMember,
  fakeTextChannel,
  fakeVoiceChannel,
} from './helpers/fakes.js';

const LINK = 'https://youtu.be/dQw4w9WgXcQ';

// A registry whose players are stubs, so these tests cover only the command.
function setUp({ startsNow = true, idle = false, member, channel } = {}) {
  const media = fakeMedia();
  const created = [];
  const players = new PlayerRegistry({
    media,
    createPlayer: (options) => {
      const player = {
        options,
        enqueue: vi.fn(() => startsNow),
        destroy: () => options.onDestroy(player),
        idle,
      };
      created.push(player);
      return player;
    },
  });
  const message = fakeGuildMessage({ member, channel, client: { media, players } });
  return { message, media, players, created };
}

const run = (message, args = [LINK]) => play.execute(message, args);

describe('!play', () => {
  it('looks up the song and queues it for the requester', async () => {
    const { message, media, created } = setUp();
    await run(message);

    expect(media.fetchSongInfo).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(created).toHaveLength(1);
    expect(created[0].options.voiceChannel).toBe(message.member.voice.channel);
    expect(created[0].options.textChannel).toBe(message.channel);
    expect(created[0].enqueue).toHaveBeenCalledWith(
      {
        title: 'Song',
        thumbnail: null,
        duration: 213,
        url: LINK,
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        requestedBy: 'billyfan',
      },
      { audio: media.streams[0] },
    );
    // The player announces Now Playing itself.
    expect(message.channel.send).not.toHaveBeenCalled();
  });

  it('opens the stream while looking up a song that will start right away', async () => {
    const { message, media } = setUp();
    let finishLookup;
    media.fetchSongInfo.mockReturnValueOnce(new Promise((resolve) => (finishLookup = resolve)));

    const pending = run(message);
    expect(media.openAudioStream).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
    finishLookup({ title: 'Song', thumbnail: null, duration: 213 });
    await pending;
  });

  it('opens the stream early when the bot is in voice with nothing playing', async () => {
    const { message, media, created } = setUp({ idle: true });
    await run(message);
    await run(message);
    expect(media.openAudioStream).toHaveBeenCalledTimes(2);
    expect(created[0].enqueue).toHaveBeenLastCalledWith(expect.any(Object), {
      audio: media.streams[1],
    });
  });

  it('does not open the stream early when songs are playing; the player opens it later', async () => {
    const { message, media, created } = setUp({ idle: false });
    await run(message);
    await run(message);
    expect(media.openAudioStream).toHaveBeenCalledOnce();
    expect(created[0].enqueue).toHaveBeenLastCalledWith(expect.any(Object), { audio: null });
  });

  it('opens only one early stream for a burst of !play while nothing is playing', async () => {
    const { message, media, created } = setUp();
    const lookups = [];
    media.fetchSongInfo.mockImplementation(() => new Promise((resolve) => lookups.push(resolve)));

    const pending = [run(message), run(message), run(message)];
    expect(media.openAudioStream).toHaveBeenCalledOnce();

    for (const resolve of lookups) resolve({ title: 'Song', thumbnail: null, duration: 1 });
    await Promise.all(pending);
    const audios = created[0].enqueue.mock.calls.map(([, { audio }]) => audio);
    expect(audios).toEqual([media.streams[0], null, null]);
  });

  it('lets the next !play open an early stream once the lookup is over', async () => {
    const { message, media, players } = setUp();
    await run(message);
    expect(players.claimEarlyStream(message.guild.id)).toBe(true);
    players.releaseEarlyStream(message.guild.id);
    expect(media.openAudioStream).toHaveBeenCalledOnce();
  });

  it('lets the next !play open an early stream after a lookup fails', async () => {
    const { message, media } = setUp();
    media.fetchSongInfo.mockRejectedValueOnce(new Error('Video unavailable'));
    await run(message);
    await run(message);
    expect(media.openAudioStream).toHaveBeenCalledTimes(2);
    expect(media.streams[0].stop).toHaveBeenCalled();
  });

  it('lets the next !play open an early stream after the early open throws', async () => {
    // The bot stays in voice with nothing playing after the first song is queued.
    const { message, media } = setUp({ idle: true });
    media.openAudioStream.mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });
    await run(message);
    await run(message);
    expect(media.openAudioStream).toHaveBeenCalledTimes(2);
  });

  it('still queues the song if the stream cannot be opened early', async () => {
    const { message, media, created } = setUp();
    media.openAudioStream.mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });
    await run(message);
    expect(created[0].enqueue).toHaveBeenCalledWith(expect.any(Object), { audio: null });
  });

  it('shows Added to Queue when the song waits behind others', async () => {
    const { message } = setUp({ startsNow: false });
    await run(message);

    const [[options]] = message.channel.send.mock.calls;
    expect(options.embeds[0].data).toMatchObject({
      title: 'Added to Queue',
      description: 'Song',
      url: LINK,
      footer: { text: 'BillyTube' },
    });
  });

  it('reuses the server player for later songs', async () => {
    const { message, created } = setUp();
    await run(message);
    await run(message);
    expect(created).toHaveLength(1);
    expect(created[0].enqueue).toHaveBeenCalledTimes(2);
  });

  // Same checks, in the same order, as before 3.1.
  it('only works in the music_bot channel', async () => {
    const { message, media } = setUp({ channel: fakeTextChannel({ name: 'general' }) });
    await run(message);
    expect(message.channel.send).toHaveBeenCalledWith(
      '<@300000000000000001> please use the music_bot channel to use BillyTube.',
    );
    expect(media.fetchSongInfo).not.toHaveBeenCalled();
  });

  it('needs the requester in a voice channel', async () => {
    const { message } = setUp({ member: fakeMember({ voiceChannel: null }) });
    await run(message);
    expect(message.channel.send).toHaveBeenCalledWith(NOT_IN_VOICE);
  });

  it('needs the DJ role', async () => {
    const { message } = setUp({ member: fakeMember({ roles: ['Member'] }) });
    await run(message);
    expect(message.channel.send).toHaveBeenCalledWith(
      "<@300000000000000001> I'm sorrrry. You don't have the required privleges to use BillyTube.",
    );
  });

  it('turns Spotify links away', async () => {
    const { message, media } = setUp();
    await run(message, ['https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC']);
    expect(message.channel.send).toHaveBeenCalledWith(SPOTIFY_UNSUPPORTED);
    expect(media.fetchSongInfo).not.toHaveBeenCalled();
  });

  it.each([[[]], [['https://example.com/song']]])('rejects %j as not YouTube', async (args) => {
    const { message } = setUp();
    await run(message, args);
    expect(message.channel.send).toHaveBeenCalledWith(UNSUPPORTED_LINK);
  });

  it('reports a song that cannot be looked up', async () => {
    const { message, media, created } = setUp();
    media.fetchSongInfo.mockRejectedValueOnce(new Error('Video unavailable'));
    await run(message);
    expect(message.channel.send).toHaveBeenCalledWith(DOWNLOAD_FAILED);
    expect(created).toHaveLength(0);
    expect(media.streams[0].stop).toHaveBeenCalled();
  });

  it('drops a song still loading when the bot leaves voice', async () => {
    const { message, media, players, created } = setUp({ idle: true });
    await run(message);
    let finishLookup;
    media.fetchSongInfo.mockReturnValueOnce(new Promise((resolve) => (finishLookup = resolve)));

    const pending = run(message);
    created[0].destroy(); // !leave, or alone in the channel
    finishLookup({ title: 'Late', thumbnail: null, duration: 1 });
    await pending;

    expect(created).toHaveLength(1);
    expect(players.get(message.guild.id)).toBeUndefined();
    // Nothing was playing when the late song was requested, so its stream was opened early.
    expect(media.streams.at(-1).stop).toHaveBeenCalled();
  });

  it('uses the voice channel at request time if the requester left voice during the lookup', async () => {
    const voiceChannel = fakeVoiceChannel();
    const member = fakeMember({ voiceChannel });
    const { message, media, created } = setUp({ member });
    media.fetchSongInfo.mockImplementationOnce(async () => {
      member.voice.channel = null;
      return { title: 'Song', thumbnail: null, duration: 1 };
    });
    await run(message);
    expect(created[0].options.voiceChannel).toBe(voiceChannel);
  });
});
