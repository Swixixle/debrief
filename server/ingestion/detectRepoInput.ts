import { matchCloneAnalyzeUrl } from "@shared/cloneAnalyzeUrl";
import { hostedHttpsGitToIngestInput } from "./ingest";
import type { IngestInput } from "./types";

/** Best-effort URL → ingest input for public API (`/api/v1/analyze`). */
export function detectIngestInputFromRepoUrl(repoUrl: string): IngestInput {
  const t = repoUrl.trim();
  const m = matchCloneAnalyzeUrl(t);
  if (m) return { type: "replit", url: t };
  try {
    return hostedHttpsGitToIngestInput(t);
  } catch {
    return { type: "url", url: t };
  }
}
