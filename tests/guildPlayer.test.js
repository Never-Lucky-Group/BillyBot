import { AudioPlayerStatus, StreamType, VoiceConnectionStatus } from '@discordjs/voice';
import { describe, expect, it, vi } from 'vitest';
import { DOWNLOAD_FAILED, NO_VOICE_PERMISSION, VOICE_CONNECT_FAILED } from '../src/lib/replies.js';
import { GuildPlayer } from '../src/music/guildPlayer.js';
import {
  fakeMedia,
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
    expect(media.openAudioStream).toHaveBeenCalledWith(fakeSong().videoUrl, expect.any(Object));
    expect(voice.createAudioResource).toHaveBeenCalledWith(
      media.streams[0].stream,
      expect.objectContaining({ inputType: StreamType.OggOpus }),
    );
    expect(voice.player.play).toHaveBeenCalledOnce();
    expect(player.current.song.title).toBe('First');
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
