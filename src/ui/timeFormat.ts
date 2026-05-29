export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}시간 ${minutes.toString().padStart(2, "0")}분`;
  }
  return minutes > 0 ? `${minutes}분 ${seconds.toString().padStart(2, "0")}초` : `${seconds}초`;
}
