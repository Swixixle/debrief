import { describe, it, expect } from 'vitest';
import { scanCoverage } from "../coverage/scanCoverage";
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

function createTempRepo() {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'covrepo-'));
  execSync('git init', { cwd: tmp });
  fs.mkdirSync(path.join(tmp, 'src'));
  fs.mkdirSync(path.join(tmp, 'data'));
  fs.mkdirSync(path.join(tmp, 'big'));
  fs.mkdirSync(path.join(tmp, 'notes'));
  fs.mkdirSync(path.join(tmp, 'weird'));
  fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(tmp, 'src', 'b.py'), 'x = 1\n');
  fs.writeFileSync(path.join(tmp, 'data', 'blob.bin'), Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
  fs.writeFileSync(path.join(tmp, 'big', 'huge.txt'), 'a'.repeat(600 * 1024));
  fs.writeFileSync(path.join(tmp, 'notes', 'readme.md'), '# Readme\n');
  fs.writeFileSync(path.join(tmp, 'weird', 'file.xyz'), 'strange content\n');
  execSync('git add .', { cwd: tmp });
  execSync('git commit -m "test files"', { cwd: tmp });
  return tmp;
}

describe('Coverage Scan Engine', () => {
  it('classifies files correctly', () => {
    const repo = createTempRepo();
    const summary = scanCoverage({ repoPath: repo, maxBytes: 512 * 1024 });
    expect(summary.total_files).toBe(6);
    expect(summary.analyzed_files).toBe(3); // a.ts, b.py, readme.md
    expect(summary.skipped_files).toBe(3); // blob.bin, huge.txt, file.xyz
    expect(summary.statuses['ANALYZED']).toBe(3);
    expect(summary.statuses['BINARY_OR_UNREADABLE']).toBe(1);
    expect(summary.statuses['TOO_LARGE']).toBe(1);
    expect(summary.statuses['UNSUPPORTED_LANGUAGE']).toBe(1);
    expect(summary.skipped_reasons['binary_detected']).toBe(1);
    expect(summary.skipped_reasons['too_large']).toBe(1);
    expect(summary.skipped_reasons['unsupported_extension']).toBe(1);
    expect(summary.percent_coverage).toBeCloseTo(50, 1);
    // Directory rollups
    const srcDir = summary.directories.find(d => d.path.startsWith('src'));
    expect(srcDir?.analyzed_files).toBe(2);
    const notesDir = summary.directories.find(d => d.path.startsWith('notes'));
    expect(notesDir?.analyzed_files).toBe(1);
    const bigDir = summary.directories.find(d => d.path.startsWith('big'));
    expect(bigDir?.skipped_files).toBe(1);
    // Exclude test
    const summary2 = scanCoverage({ repoPath: repo, maxBytes: 512 * 1024, excludeGlobs: ['notes/**'] });
    const notesEntry = summary2.files.find(f => f.path.startsWith('notes/readme.md'));
    expect(notesEntry?.status).toBe('EXCLUDED_BY_RULE');
    expect(notesEntry?.reason).toBe('excluded_by_glob');
    expect(summary2.statuses['EXCLUDED_BY_RULE']).toBe(1);
    expect(summary2.skipped_reasons['excluded_by_glob']).toBe(1);
  });
});
