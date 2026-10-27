import { spawn } from 'node:child_process';
import { logger } from '../lib/logger.js';

// How long looking up a song's details may take before it counts as failed.
const INFO_TIMEOUT_MS = 30_000;
// Only the fields the bot shows, printed as one JSON line. yt-dlp's full JSON is around a megabyte.
const INFO_TEMPLATE = '%(.{title,thumbnail,duration})j';
// How much of a program's error output to keep for the log.
const MAX_STDERR_CHARS = 2_000;

// yt-dlp needs a JavaScript runtime for YouTube. Pointing it at this Node means it works under
// systemd, whose PATH may not include Node (e.g. when Node is installed with nvm).
const JS_RUNTIME = `node:${process.execPath}`;

// Everything that runs yt-dlp and ffmpeg. Songs are streamed: yt-dlp downloads the audio into
// ffmpeg, which converts it to Ogg Opus, which @discordjs/voice sends to Discord as is. Nothing is
// written to disk.
export function createMedia({ ytdlpPath, ffmpegPath, spawnProcess = spawn }) {
  return {
    // Looks up a video. Resolves to { title, thumbnail, duration }; rejects if yt-dlp fails (an
    // unavailable or private video, a network problem) or takes too long.
    async fetchSongInfo(videoUrl) {
      const stdout = await run(
        spawnProcess,
        ytdlpPath,
        [
          '--no-playlist',
          '--no-warnings',
          '--js-runtimes',
          JS_RUNTIME,
          '--skip-download',
          '--print',
          INFO_TEMPLATE,
          '--',
          videoUrl,
        ],
        INFO_TIMEOUT_MS,
      );
      const line = stdout.split('\n').find((text) => text.trim() !== '');
      if (!line) throw new Error('yt-dlp printed no song details');
      const info = JSON.parse(line);
      return {
        title: info.title || 'Unknown Title',
        thumbnail: info.thumbnail || null,
        duration: info.duration ?? null,
      };
    },

    // Starts streaming a video's audio. Returns { stream, stop, setErrorHandler }:
    //   stream                 Ogg Opus for createAudioResource. Until it is read, the programs
    //                          pause once the pipes are full, so it can be opened ahead of time.
    //   stop()                 ends both programs; call it when the song is done, skipped or not
    //                          needed after all
    //   setErrorHandler(fn)    fn(error) is called at most once if either program fails before
    //                          stop(). An error from before fn was set is passed on asynchronously.
    openAudioStream(videoUrl) {
      const ytdlp = spawnProcess(
        ytdlpPath,
        [
          '--no-playlist',
          '--no-warnings',
          '--quiet',
          '--js-runtimes',
          JS_RUNTIME,
          '--format',
          'bestaudio/best',
          '--output',
          '-',
          '--',
          videoUrl,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const ffmpeg = spawnProcess(
        ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          'pipe:0',
          '-vn',
          '-c:a',
          'libopus',
          '-b:a',
          '128k',
          '-ar',
          '48000',
          '-ac',
          '2',
          '-f',
          'ogg',
          'pipe:1',
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );

      let stopped = false;
      let failed = false;
      let handler = null;
      let pendingError = null;
      const fail = (error) => {
        if (stopped || failed) return;
        failed = true;
        if (handler) handler(error);
        else pendingError = error;
      };

      watchProcess(ytdlp, 'yt-dlp', fail);
      watchProcess(ffmpeg, 'ffmpeg', fail);

      // When one program ends early the pipe between them breaks (EPIPE). Unhandled, that error
      // would stop the bot; the exit codes above already report what went wrong.
      ffmpeg.stdin.on('error', (error) => logger.debug({ err: error }, 'ffmpeg input closed'));
      ytdlp.stdout.on('error', (error) => logger.debug({ err: error }, 'yt-dlp output closed'));
      ytdlp.stdout.pipe(ffmpeg.stdin);

      return {
        stream: ffmpeg.stdout,
        setErrorHandler(fn) {
          handler = fn;
          if (pendingError) {
            const error = pendingError;
            pendingError = null;
            queueMicrotask(() => {
              if (!stopped) fn(error);
            });
          }
        },
        stop() {
          stopped = true;
          for (const child of [ytdlp, ffmpeg]) {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          }
        },
      };
    },

    // Logs the yt-dlp and ffmpeg versions, or an error if either cannot be run. Never rejects:
    // without them no song can play, but the other commands still work.
    async checkTools() {
      for (const [name, path, args] of [
        ['yt-dlp', ytdlpPath, ['--version']],
        ['ffmpeg', ffmpegPath, ['-version']],
      ]) {
        try {
          const output = await run(spawnProcess, path, args, INFO_TIMEOUT_MS);
          logger.info({ version: output.split('\n')[0].trim() }, `Found ${name}`);
        } catch (error) {
          logger.error({ err: error, path }, `Could not run ${name}; songs cannot play`);
        }
      }
    },
  };
}

// Runs a program to completion. Resolves to its output, or rejects with its error output if it
// cannot start, exits with an error, or is still running after `timeoutMs`.
function run(spawnProcess, command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    });
    let stdout = '';
    const stderr = collectStderr(child);
    // Decodes across chunks, so a character split between two chunks (é, ポ, emoji) stays whole.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        const reason = signal
          ? `was stopped (${signal}), probably timed out`
          : `exited with ${code}`;
        reject(new Error(`${command} ${reason}: ${stderr.text().trim()}`));
      }
    });
  });
}

// Calls `fail` if a streaming program cannot start or exits with an error.
function watchProcess(child, name, fail) {
  const stderr = collectStderr(child);
  child.on('error', (error) => fail(new Error(`Could not run ${name}: ${error.message}`)));
  child.on('close', (code, signal) => {
    if (code !== 0) {
      const reason = signal ? `was stopped (${signal})` : `exited with ${code}`;
      fail(new Error(`${name} ${reason}: ${stderr.text().trim()}`));
    }
  });
}

// Keeps the last part of a program's error output.
function collectStderr(child) {
  let text = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    text = (text + chunk).slice(-MAX_STDERR_CHARS);
  });
  return { text: () => text };
}
