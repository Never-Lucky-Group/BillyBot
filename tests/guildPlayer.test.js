import { AudioPlayerStatus, StreamType, VoiceConnectionStatus } from '@discordjs/voice';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOWNLOAD_FAILED, NO_VOICE_PERMISSION, VOICE_CONNECT_FAILED } from '../src/lib/replies.js';
import { GuildPlayer, IDLE_LEAVE_MS, PRELOAD_LEAD_MS } from '../src/music/guildPlayer.js';
import {
  fakeMedia,
  fakeSentMessage,
  fakeSong,
  fakeTextChannel,
  fakeVoice,
  fakeVoiceChannel,
  flush,
} from './helpers/fakes.js';

function setUp({ canSpeak = true } = {}) {
  const voice = fakeVoice();
  const media = fakeMedia();
  const textChannel = fakeTextChannel();
  const voiceChannel = fakeVoiceChannel({ canSpeak });
  const onDestroy = vi.fn();
  const player = new GuildPlayer({ voiceChannel, textChannel, media, onDestroy, voice });
  return { player, voice, media, textChannel, voiceChannel, onDestroy };
}

const embedTitles = (textChannel) =>
  textChannel.send.mock.calls.map(([options]) => options.embeds?.[0]?.data.title).filter(Boolean);

describe('GuildPlayer', () => {
  it('joins the voice channel and streams the first song as Ogg Opus', async () => {
    const { player, voice, media, voiceChannel } = setUp();

    expect(player.enqueue(fakeSong('First'))).toBe(true);
    await flush();

    expect(voice.joinVoiceChannel).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: voiceChannel.id, guildId: voiceChannel.guild.id }),
    );
    expect(voice.connection.subscribe).toHaveBeenCalledWith(voice.player);
    expect(media.openAudioStream).toHaveBeenCalledWith(fakeSong().videoUrl);
    expect(voice.createAudioResource).toHaveBeenCalledWith(
      media.streams[0].stream,
      expect.objectContaining({ inputType: StreamType.OggOpus }),
    );
    expect(voice.player.play).toHaveBeenCalledOnce();
    expect(player.current.song.title).toBe('First');
  });

  it('reports the playing song and how far into it playback is', async () => {
    const { player, voice } = setUp();
    expect(player.nowPlaying).toBeNull();

    player.enqueue(fakeSong('First'));
    player.enqueue(fakeSong('Second'));
    await flush();
    expect(player.nowPlaying).toEqual({ song: fakeSong('First'), elapsedMs: 0 });

    voice.player.state.resource.playbackDuration = 84_000;
    expect(player.nowPlaying.elapsedMs).toBe(84_000);

    voice.player.finish();
    await flush();
    expect(player.nowPlaying.song.title).toBe('Second');
    expect(player.nowPlaying.elapsedMs).toBe(0);
  });

  it('announces Now Playing once audio starts, and only once per song', async () => {
    const { player, voice, textChannel } = setUp();
    player.enqueue(fakeSong('First'));
    await flush();
    expect(embedTitles(textChannel)).toEqual([]);

    voice.player.startPlaying();
    // e.g. paused while the connection recovered, then playing again
    voice.player.setState({
      status: AudioPlayerStatus.AutoPaused,
      resource: voice.player.state.resource,
    });
    voice.player.startPlaying();
    await flush();

    expect(embedTitles(textChannel)).toEqual(['🎶 Now Playing']);
    expect(textChannel.send.mock.calls[0][0].embeds[0].data.description).toBe('First');
  });

  it('queues songs requested while the bot is still joining instead of playing over them', async () => {
    const { player, voice } = setUp();
    let ready;
    voice.entersState.mockReturnValueOnce(new Promise((resolve) => (ready = resolve)));

    expect(player.enqueue(fakeSong('First'))).toBe(true);
    expect(player.enqueue(fakeSong('Second'))).toBe(false);
    await flush();
    expect(voice.player.play).not.toHaveBeenCalled();

    ready();
    await flush();
    expect(voice.player.play).toHaveBeenCalledOnce();
    expect(player.current.song.title).toBe('First');
    expect(player.queue.map((song) => song.title)).toEqual(['Second']);
    expect(voice.joinVoiceChannel).toHaveBeenCalledOnce();
  });

  it('plays the next song when one ends, stopping the finished stream', async () => {
    const { player, voice, media } = setUp();
    player.enqueue(fakeSong('First'));
    player.enqueue(fakeSong('Second'));
    await flush();
    voice.player.startPlaying();

    voice.player.finish();
    await flush();

    expect(media.streams[0].stop).toHaveBeenCalled();
    expect(player.current.song.title).toBe('Second');
    expect(player.queue).toEqual([]);
  });

  it('stays in the channel with nothing current after the last song', async () => {
    const { player, voice, onDestroy } = setUp();
    player.enqueue(fakeSong('First'));
    await flush();
    voice.player.startPlaying();
    voice.player.finish();
    await flush();

    expect(player.current).toBeNull();
    expect(player.destroyed).toBe(false);
    expect(onDestroy).not.toHaveBeenCalled();
    expect(player.enqueue(fakeSong('Later'))).toBe(true);
  });

  it('skips to the next song, or reports nothing to skip', async () => {
    const { player, voice } = setUp();
    expect(player.skip()).toBe(false);

    player.enqueue(fakeSong('First'));
    player.enqueue(fakeSong('Second'));
    await flush();
    // Skipping works while the song is still buffering too.
    expect(player.skip()).toBe(true);
    await flush();

    expect(voice.player.stop).toHaveBeenCalledWith(true);
    expect(player.current.song.title).toBe('Second');
  });

  it('tells the channel and leaves when it may not join or speak in voice', async () => {
    const { player, voice, textChannel, onDestroy } = setUp({ canSpeak: false });
    player.enqueue(fakeSong());
    player.enqueue(fakeSong());
    await flush();

    expect(voice.joinVoiceChannel).not.toHaveBeenCalled();
    expect(textChannel.send).toHaveBeenCalledWith(NO_VOICE_PERMISSION);
    expect(player.destroyed).toBe(true);
    expect(player.queue).toEqual([]);
    expect(onDestroy).toHaveBeenCalledWith(player);
  });

  it('tells the channel and leaves when joining voice times out', async () => {
    const { player, voice, textChannel } = setUp();
    voice.entersState.mockRejectedValueOnce(new Error('timed out'));
    player.enqueue(fakeSong());
    await flush();

    expect(textChannel.send).toHaveBeenCalledWith(VOICE_CONNECT_FAILED);
    expect(voice.connection.destroy).toHaveBeenCalled();
    expect(player.destroyed).toBe(true);
    expect(voice.player.play).not.toHaveBeenCalled();
  });

  it('reports a failed stream once, then moves on to the next song', async () => {
    const { player, voice, media, textChannel } = setUp();
    player.enqueue(fakeSong('Broken'));
    player.enqueue(fakeSong('Next'));
    await flush();

    media.streams[0].onError(new Error('yt-dlp exited with 1'));
    voice.player.emit(
      'error',
      Object.assign(new Error('bad stream'), { resource: voice.player.state.resource }),
    );
    voice.player.finish();
    await flush();

    expect(textChannel.send.mock.calls.filter(([text]) => text === DOWNLOAD_FAILED)).toHaveLength(
      1,
    );
    expect(player.current.song.title).toBe('Next');
  });

  it('reports a song that cannot start and tries the next one', async () => {
    const { player, media, textChannel } = setUp();
    media.openAudioStream.mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });
    player.enqueue(fakeSong('Broken'));
    player.enqueue(fakeSong('Next'));
    await flush();
    await flush();

    expect(textChannel.send).toHaveBeenCalledWith(DOWNLOAD_FAILED);
    expect(player.current.song.title).toBe('Next');
  });

  it('leaves for good when destroyed: queue dropped, stream and connection stopped', async () => {
    const { player, voice, media, onDestroy } = setUp();
    player.enqueue(fakeSong('First'));
    player.enqueue(fakeSong('Second'));
    await flush();

    player.destroy();
    player.destroy();
    await flush();

    expect(player.queue).toEqual([]);
    expect(player.current).toBeNull();
    expect(media.streams[0].stop).toHaveBeenCalled();
    expect(voice.connection.destroy).toHaveBeenCalledOnce();
    expect(onDestroy).toHaveBeenCalledOnce();
    expect(media.openAudioStream).toHaveBeenCalledOnce();
  });

  it('cleans up when something else destroys the voice connection', async () => {
    const { player, voice, onDestroy } = setUp();
    player.enqueue(fakeSong());
    await flush();

    voice.connection.setStatus(VoiceConnectionStatus.Destroyed);

    expect(player.destroyed).toBe(true);
    expect(onDestroy).toHaveBeenCalledOnce();
  });

  it('leaves when disconnected and the connection does not recover (e.g. kicked)', async () => {
    const { player, voice } = setUp();
    player.enqueue(fakeSong());
    await flush();

    voice.entersState.mockRejectedValue(new Error('timed out'));
    voice.connection.setStatus(VoiceConnectionStatus.Disconnected);
    await flush();

    expect(player.destroyed).toBe(true);
  });

  it('stays when disconnected but the connection recovers (e.g. moved channel)', async () => {
    const { player, voice } = setUp();
    player.enqueue(fakeSong());
    await flush();

    voice.connection.joinConfig.channelId = '200000000000000777';
    voice.connection.setStatus(VoiceConnectionStatus.Disconnected);
    await flush();

    expect(player.destroyed).toBe(false);
    expect(player.channelId).toBe('200000000000000777');
  });
});

describe('GuildPlayer preloading', () => {
  // fakeSong() is 213 seconds long. setImmediate stays real so flush() still works.
  const SONG_MS = 213_000;

  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  const lastResourceStream = (voice) => voice.createAudioResource.mock.calls.at(-1)[0];
  const failures = (textChannel) =>
    textChannel.send.mock.calls.filter(([text]) => text === DOWNLOAD_FAILED);

  async function playingWithNext() {
    const setup = setUp();
    setup.player.enqueue(fakeSong('First'));
    setup.player.enqueue(fakeSong('Next'));
    await flush();
    setup.voice.player.startPlaying();
    return setup;
  }

  it('opens the next song shortly before the playing one ends, and plays from it', async () => {
    const { voice, media } = await playingWithNext();

    vi.advanceTimersByTime(SONG_MS - PRELOAD_LEAD_MS - 1);
    expect(media.openAudioStream).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(media.openAudioStream).toHaveBeenCalledTimes(2);

    voice.player.finish();
    await flush();
    expect(media.openAudioStream).toHaveBeenCalledTimes(2);
    expect(lastResourceStream(voice)).toBe(media.streams[1].stream);
  });

  it('preloads a song queued near the end of the playing one straight away', async () => {
    const { player, voice, media } = setUp();
    player.enqueue(fakeSong('First'));
    await flush();
    voice.player.startPlaying();
    vi.advanceTimersByTime(SONG_MS - 10_000);
    expect(media.openAudioStream).toHaveBeenCalledOnce();

    player.enqueue(fakeSong('Late'));
    expect(media.openAudioStream).toHaveBeenCalledTimes(2);

    voice.player.finish();
    await flush();
    expect(lastResourceStream(voice)).toBe(media.streams[1].stream);
  });

  it('opens the next song when a song is skipped before preloading', async () => {
    const { player, voice, media } = await playingWithNext();
    player.skip();
    await flush();
    expect(media.openAudioStream).toHaveBeenCalledTimes(2);
    expect(lastResourceStream(voice)).toBe(media.streams[1].stream);
  });

  it('does not preload after a song with no length (a livestream)', async () => {
    const { player, voice, media } = setUp();
    player.enqueue({ ...fakeSong('Live'), duration: null });
    player.enqueue(fakeSong('Next'));
    await flush();
    voice.player.startPlaying();
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(media.openAudioStream).toHaveBeenCalledOnce();
  });

  it('drops a failed preload quietly and opens the song again when its turn comes', async () => {
    const { voice, media, textChannel } = await playingWithNext();
    vi.advanceTimersByTime(SONG_MS);
    media.streams[1].onError(new Error('yt-dlp exited with 1'));
    expect(media.streams[1].stop).toHaveBeenCalled();

    voice.player.finish();
    await flush();
    expect(media.openAudioStream).toHaveBeenCalledTimes(3);
    expect(lastResourceStream(voice)).toBe(media.streams[2].stream);
    expect(failures(textChannel)).toHaveLength(0);
  });

  it('stops the preloaded stream and the timer when destroyed', async () => {
    const { player, media } = await playingWithNext();
    vi.advanceTimersByTime(SONG_MS);
    player.destroy();
    expect(media.streams[1].stop).toHaveBeenCalled();

    const other = await playingWithNext();
    other.player.destroy();
    vi.advanceTimersByTime(SONG_MS);
    expect(other.media.openAudioStream).toHaveBeenCalledOnce();
  });

  it('plays the first song from a stream the caller opened early', async () => {
    const { player, voice, media } = setUp();
    const audio = media.openAudioStream(fakeSong().videoUrl);

    expect(player.enqueue(fakeSong('First'), { audio })).toBe(true);
    await flush();

    expect(media.openAudioStream).toHaveBeenCalledOnce();
    expect(lastResourceStream(voice)).toBe(audio.stream);
    expect(audio.stop).not.toHaveBeenCalled();
  });

  it('stops an early stream it cannot use: the song waits behind others', async () => {
    const { player, media } = await playingWithNext();
    const audio = media.openAudioStream(fakeSong().videoUrl);
    expect(player.enqueue(fakeSong('Third'), { audio })).toBe(false);
    expect(audio.stop).toHaveBeenCalled();
  });

  it('stops an early stream it cannot use: the player was destroyed', () => {
    const { player, media } = setUp();
    player.destroy();
    const audio = media.openAudioStream(fakeSong().videoUrl);
    player.enqueue(fakeSong(), { audio });
    expect(audio.stop).toHaveBeenCalled();
  });

  it('opens the first song again if its early stream fails while joining', async () => {
    const { player, voice, media, textChannel } = setUp();
    let ready;
    voice.entersState.mockReturnValueOnce(new Promise((resolve) => (ready = resolve)));
    const audio = media.openAudioStream(fakeSong().videoUrl);
    player.enqueue(fakeSong('First'), { audio });

    audio.onError(new Error('yt-dlp exited with 1'));
    ready();
    await flush();

    expect(media.openAudioStream).toHaveBeenCalledTimes(2);
    expect(lastResourceStream(voice)).toBe(media.streams[1].stream);
    expect(failures(textChannel)).toHaveLength(0);
  });
});

describe('GuildPlayer status card', () => {
  // A first song that came with its "Searching…" card from !play.
  async function startWithCard(setupOptions, beforeEnqueue = () => {}) {
    const setup = setUp(setupOptions);
    beforeEnqueue(setup);
    const card = fakeSentMessage();
    setup.player.enqueue(fakeSong('First'), { statusMessage: card });
    await flush();
    return { ...setup, card };
  }

  const editedText = (card) => card.edit.mock.calls.map(([options]) => options.content);

  it('turns the card into Now Playing when the audio starts, instead of a new message', async () => {
    const { voice, card, textChannel } = await startWithCard();
    expect(card.edit).not.toHaveBeenCalled();

    voice.player.startPlaying();
    await flush();

    expect(card.edit).toHaveBeenCalledOnce();
    expect(card.edit.mock.calls[0][0].embeds[0].data).toMatchObject({
      title: '🎶 Now Playing',
      description: 'First',
    });
    expect(textChannel.send).not.toHaveBeenCalled();
  });

  it('gives later songs a new Now Playing message, as before', async () => {
    const { player, voice, card, textChannel } = await startWithCard();
    player.enqueue(fakeSong('Second'));
    voice.player.startPlaying();
    voice.player.finish();
    await flush();
    voice.player.startPlaying();
    await flush();

    expect(card.edit).toHaveBeenCalledOnce();
    expect(embedTitles(textChannel)).toEqual(['🎶 Now Playing']);
  });

  it('turns the card into the error when the bot may not join or speak', async () => {
    const { card, textChannel } = await startWithCard({ canSpeak: false });
    expect(editedText(card)).toEqual([NO_VOICE_PERMISSION]);
    expect(card.delete).not.toHaveBeenCalled();
    expect(textChannel.send).not.toHaveBeenCalled();
  });

  it('turns the card into the error when joining voice times out', async () => {
    const { card } = await startWithCard(undefined, ({ voice }) =>
      voice.entersState.mockRejectedValueOnce(new Error('timed out')),
    );
    expect(editedText(card)).toEqual([VOICE_CONNECT_FAILED]);
  });

  it('turns the card into the error when the stream fails before any audio', async () => {
    const { voice, media, card } = await startWithCard();
    media.streams[0].onError(new Error('yt-dlp exited with 1'));
    voice.player.finish();
    await flush();
    expect(editedText(card)).toEqual([DOWNLOAD_FAILED]);
  });

  it('turns the card into the error when the stream ends without audio or an error', async () => {
    const { voice, card } = await startWithCard();
    voice.player.finish();
    await flush();
    expect(editedText(card)).toEqual([DOWNLOAD_FAILED]);
  });

  it('deletes the card when the song is skipped before its audio starts', async () => {
    const { player, card, textChannel } = await startWithCard();
    player.skip();
    await flush();
    expect(card.delete).toHaveBeenCalled();
    expect(card.edit).not.toHaveBeenCalled();
    expect(textChannel.send).not.toHaveBeenCalled();
  });

  it('deletes the card when the bot leaves before the song starts', async () => {
    const { player, card } = await startWithCard();
    player.destroy();
    await flush();
    expect(card.delete).toHaveBeenCalled();
    expect(card.edit).not.toHaveBeenCalled();
  });

  it('leaves the card of a song that waits behind others to the caller', async () => {
    const { player } = await startWithCard();
    const waitingCard = fakeSentMessage();
    expect(player.enqueue(fakeSong('Second'), { statusMessage: waitingCard })).toBe(false);
    player.destroy();
    await flush();
    expect(waitingCard.edit).not.toHaveBeenCalled();
    expect(waitingCard.delete).not.toHaveBeenCalled();
  });

  it('deletes the card of a song queued on a destroyed player', async () => {
    const { player } = setUp();
    player.destroy();
    const card = fakeSentMessage();
    player.enqueue(fakeSong(), { statusMessage: card });
    await flush();
    expect(card.delete).toHaveBeenCalled();
  });

  it('sends Now Playing as a new message if the card was deleted meanwhile', async () => {
    const { voice, card, textChannel } = await startWithCard();
    card.edit.mockRejectedValueOnce(new Error('Unknown Message'));
    voice.player.startPlaying();
    await flush();
    expect(embedTitles(textChannel)).toEqual(['🎶 Now Playing']);
  });
});

describe('GuildPlayer idle leave', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  async function finishedLastSong() {
    const setup = setUp();
    setup.player.enqueue(fakeSong('Only'));
    await flush();
    setup.voice.player.startPlaying();
    setup.voice.player.finish();
    await flush();
    return setup;
  }

  it('leaves silently after 30 minutes with nothing playing', async () => {
    const { player, textChannel, onDestroy } = await finishedLastSong();
    const sentBefore = textChannel.send.mock.calls.length;

    vi.advanceTimersByTime(IDLE_LEAVE_MS - 1);
    expect(player.destroyed).toBe(false);
    vi.advanceTimersByTime(1);

    expect(player.destroyed).toBe(true);
    expect(onDestroy).toHaveBeenCalledOnce();
    expect(textChannel.send.mock.calls.length).toBe(sentBefore);
  });

  it('starts the 30 minutes again after a song played meanwhile', async () => {
    const { player, voice } = await finishedLastSong();
    vi.advanceTimersByTime(IDLE_LEAVE_MS - 60_000);
    player.enqueue(fakeSong('Another'));
    await flush();
    voice.player.startPlaying();
    vi.advanceTimersByTime(IDLE_LEAVE_MS);
    expect(player.destroyed).toBe(false);

    voice.player.finish();
    await flush();
    vi.advanceTimersByTime(IDLE_LEAVE_MS);
    expect(player.destroyed).toBe(true);
  });

  it('never counts a long song as idle', async () => {
    const { player, voice } = setUp();
    player.enqueue({ ...fakeSong('Live'), duration: null });
    await flush();
    voice.player.startPlaying();
    vi.advanceTimersByTime(3 * IDLE_LEAVE_MS);
    expect(player.destroyed).toBe(false);
  });

  it('counts the time after skipping the last song as idle', async () => {
    const { player, voice } = setUp();
    player.enqueue(fakeSong('Only'));
    await flush();
    voice.player.startPlaying();
    player.skip();
    await flush();
    vi.advanceTimersByTime(IDLE_LEAVE_MS);
    expect(player.destroyed).toBe(true);
  });

  it('stops the timer when the bot leaves another way first', async () => {
    const { player, onDestroy } = await finishedLastSong();
    player.destroy();
    vi.advanceTimersByTime(IDLE_LEAVE_MS);
    expect(onDestroy).toHaveBeenCalledOnce();
  });
});
