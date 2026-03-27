/** Human-readable copy for analyzer job WebSocket + polling. */
export function progressMessage(progress: number): string {
  if (progress < 0) return "Analysis failed";
  if (progress < 10) return "Preparing…";
  if (progress < 15) return "Checking cache…";
  if (progress < 30) return "Reading files…";
  if (progress < 50) return "Analyzing claims…";
  if (progress < 65) return "Building dependency graph…";
  if (progress < 75) return "Mapping API surface…";
  if (progress < 85) return "Writing report…";
  if (progress < 90) return "Signing receipt…";
  if (progress < 100) return "Saving…";
  return "Done";
}
