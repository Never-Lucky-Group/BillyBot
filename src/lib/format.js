// Formats a song length in seconds as m:ss, or h:mm:ss from an hour up. Returns "Unknown" when
// the length is missing or not a number (yt-dlp has no length for livestreams).
export function formatDuration(value) {
  if (value === null || value === undefined || value === '') return 'Unknown';
  const seconds = Math.floor(Number(value));
  if (!Number.isFinite(seconds) || seconds < 0) return 'Unknown';

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = String(s).padStart(2, '0');

  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
