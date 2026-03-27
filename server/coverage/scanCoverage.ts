import { FileCoverageStatus, CoverageReason, CoverageEntry, CoverageSummary, CoverageDirectorySummary } from './types';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const DEFAULT_MAX_BYTES = 512 * 1024;
const IGNORED_DIRS = [
  '.git', 'node_modules', 'dist', 'build', '.next', '__pycache__', 'venv', '.venv'
];

function isBinary(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(8192);
    const bytesRead = fs.readSync(fd, buffer, 0, 8192, 0);
    fs.closeSync(fd);
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function isUtf8(filePath: string): boolean {
  try {
    const data = fs.readFileSync(filePath);
    return Buffer.from(data).toString('utf8').length === data.length;
  } catch {
    return false;
  }
}

function getLanguage(ext: string): string | undefined {
  switch (ext) {
    case '.ts': return 'typescript';
    case '.js': return 'javascript';
    case '.py': return 'python';
    case '.md': return 'markdown';
    case '.json': return 'json';
    case '.yaml':
    case '.yml': return 'yaml';
    default: return undefined;
  }
}

function walkDir(root: string, excludeGlobs: string[] = []): string[] {
  const results: string[] = [];
  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.includes(entry.name)) continue;
        walk(path.join(current, entry.name));
      } else {
        const relPath = path.relative(root, path.join(current, entry.name)).replace(/\\/g, '/');
        results.push(path.join(current, entry.name));
      }
    }
  }
  walk(root);
  return results;
}

export function scanCoverage({
  repoPath,
  maxBytes = DEFAULT_MAX_BYTES,
  excludeGlobs = []
}: {
  repoPath: string;
  maxBytes?: number;
  excludeGlobs?: string[];
}): CoverageSummary {
  if (!fs.existsSync(path.join(repoPath, '.git'))) throw new Error('Not a git repo');
  const files = walkDir(repoPath, excludeGlobs);
  const entries: CoverageEntry[] = [];
  let analyzed = 0, skipped = 0;
  const statuses: Record<FileCoverageStatus, number> = {
    ANALYZED: 0,
    EXCLUDED_BY_RULE: 0,
    BINARY_OR_UNREADABLE: 0,
    TOO_LARGE: 0,
    UNSUPPORTED_LANGUAGE: 0,
    ERROR: 0,
  };
  const skippedReasons: Record<CoverageReason, number> = {
    excluded_by_glob: 0,
    excluded_by_gitignore: 0,
    binary_detected: 0,
    non_utf8: 0,
    too_large: 0,
    unsupported_extension: 0,
    analysis_error: 0,
  };

  for (const file of files) {
    const rel = path.relative(repoPath, file).replace(/\\/g, '/');
    const stat = fs.statSync(file);
    let entry: CoverageEntry = { path: rel, status: FileCoverageStatus.ERROR };
    if (excludeGlobs.some(glob => rel.startsWith(glob.replace(/\*\*/g, '')))) {
      entry.status = FileCoverageStatus.EXCLUDED_BY_RULE;
      entry.reason = 'excluded_by_glob';
      skipped++;
      skippedReasons['excluded_by_glob'] = (skippedReasons['excluded_by_glob'] || 0) + 1;
      statuses[entry.status] = (statuses[entry.status] || 0) + 1;
      entries.push(entry);
      continue;
    }
    if (stat.size > maxBytes) {
      entry.status = FileCoverageStatus.TOO_LARGE;
      entry.reason = 'too_large';
      entry.bytes = stat.size;
      skipped++;
      skippedReasons['too_large'] = (skippedReasons['too_large'] || 0) + 1;
    } else if (isBinary(file)) {
      entry.status = FileCoverageStatus.BINARY_OR_UNREADABLE;
      entry.reason = 'binary_detected';
      entry.bytes = stat.size;
      skipped++;
      skippedReasons['binary_detected'] = (skippedReasons['binary_detected'] || 0) + 1;
    } else {
      const ext = path.extname(file);
      const lang = getLanguage(ext);
      if (!lang) {
        entry.status = FileCoverageStatus.UNSUPPORTED_LANGUAGE;
        entry.reason = 'unsupported_extension';
        entry.language = ext.replace('.', '');
        skipped++;
        skippedReasons['unsupported_extension'] = (skippedReasons['unsupported_extension'] || 0) + 1;
      } else {
        entry.status = FileCoverageStatus.ANALYZED;
        entry.language = lang;
        entry.bytes = stat.size;
        entry.analyzed_by = [lang + '-analyzer'];
        analyzed++;
      }
    }
    statuses[entry.status] = (statuses[entry.status] || 0) + 1;
    entries.push(entry);
  }

  const total = files.length;
  const percent = total ? Math.round((analyzed / total) * 10000) / 100 : 0;

  // Directory rollups (recursive, normalized)
  const dirSet = new Set<string>();
  for (const entry of entries) {
    const relPath = entry.path.replace(/\\/g, '/');
    const parts = relPath.split('/');
    for (let i = 1; i <= Math.min(parts.length, 2); i++) {
      const dir = parts.slice(0, i).join('/');
      if (dir) dirSet.add(dir);
    }
  }
  const dirList = Array.from(dirSet).sort();
  const directories: CoverageDirectorySummary[] = dirList.map(dir => {
    const filesInDir = entries.filter(e => {
      const rel = e.path.replace(/\\/g, '/');
      return rel === dir || rel.startsWith(dir + '/');
    });
    const analyzed = filesInDir.filter(e => e.status === FileCoverageStatus.ANALYZED).length;
    const skipped = filesInDir.length - analyzed;
    return {
      path: dir,
      total_files: filesInDir.length,
      analyzed_files: analyzed,
      skipped_files: skipped,
      percent_coverage: filesInDir.length ? Math.round((analyzed / filesInDir.length) * 10000) / 100 : 0
    };
  });

  return {
    total_files: total,
    analyzed_files: analyzed,
    skipped_files: skipped,
    percent_coverage: percent,
    statuses,
    skipped_reasons: skippedReasons,
    directories,
    files: entries
  };
}
