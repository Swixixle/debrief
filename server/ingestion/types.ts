import type { PathLike } from "node:fs";

/** Normalized ingest request — all branches produce a local directory for PTA. */
export type IngestInput =
  | { type: "github"; url: string }
  | { type: "local"; path: string }
  | { type: "replit"; url: string }
  | { type: "zip"; filePath: string }
  | { type: "url"; url: string }
  | { type: "audio"; filePath: string }
  | { type: "text"; content: string }
  | { type: "notion"; url: string }
  | { type: "gitlab"; url: string }
  | { type: "bitbucket"; url: string };

export type AnalysisMode = "full" | "surface" | "description";

export type IngestManifestDisk = {
  input_type: string;
  input_type_detail: string;
  source_url?: string;
  commit_hash?: string;
  branch?: string;
  analysis_mode: AnalysisMode;
  ingested_at: string;
};

export type IngestResult = {
  localPath: string;
  inputType: string;
  inputTypeDetail: string;
  commitHash?: string;
  branch?: string;
  sourceUrl?: string;
  analysisMode: AnalysisMode;
  warnings: string[];
  /** Remove temp clone/extract; also registered for process exit */
  cleanup: () => Promise<void>;
};

/** Narrow path type for handlers that need a string path */
export type FsPath = string & { __brand?: "absPath" };

export function toPathLike(p: string): PathLike {
  return p;
}
