export enum FileCoverageStatus {
  ANALYZED = "ANALYZED",
  EXCLUDED_BY_RULE = "EXCLUDED_BY_RULE",
  BINARY_OR_UNREADABLE = "BINARY_OR_UNREADABLE",
  TOO_LARGE = "TOO_LARGE",
  UNSUPPORTED_LANGUAGE = "UNSUPPORTED_LANGUAGE",
  ERROR = "ERROR"
}

export type CoverageReason =
  | "excluded_by_glob"
  | "excluded_by_gitignore"
  | "binary_detected"
  | "non_utf8"
  | "too_large"
  | "unsupported_extension"
  | "analysis_error";

export interface CoverageEntry {
  path: string;
  status: FileCoverageStatus;
  reason?: CoverageReason;
  bytes?: number;
  language?: string;
  analyzed_by?: string[];
}

export interface CoverageDirectorySummary {
  path: string;
  total_files: number;
  analyzed_files: number;
  skipped_files: number;
  percent_coverage: number;
}

export interface CoverageSummary {
  total_files: number;
  analyzed_files: number;
  skipped_files: number;
  percent_coverage: number;
  statuses: Record<FileCoverageStatus, number>;
  skipped_reasons: Record<CoverageReason, number>;
  directories: CoverageDirectorySummary[];
  files: CoverageEntry[];
}
