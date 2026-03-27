import { Argv } from 'yargs';
import { scanCoverage } from "./coverage/scanCoverage";
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export function registerCoverage(y: Argv) {
  y.command(
    'coverage <repo>',
    'Generate coverage map (blind spot detection) for a git repo.',
    (yargs) =>
      yargs
        .positional('repo', {
          type: 'string',
          describe: 'Path to git repo',
        })
        .option('out', {
          type: 'string',
          demandOption: true,
          describe: 'Path to output coverage.json',
        })
        .option('max-bytes', {
          type: 'number',
          default: 512 * 1024,
          describe: 'Maximum file size to analyze (bytes)',
        })
        .option('exclude', {
          type: 'array',
          describe: 'Glob patterns to exclude',
        }),
    async (argv) => {
      console.error('[coverage] handler start');
      try {
        const repo = argv.repo as string;
        const out = argv.out as string;
        const maxBytes = argv['max-bytes'] as number;
        const exclude = (argv.exclude as string[]) || [];
        // Check if repo is a git repo
        let commitSha = '';
        try {
          commitSha = execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf8' }).trim();
        } catch (e) {
          console.error('Coverage failed: not a git repo');
          process.exitCode = 2;
          return;
        }
        // Ensure out directory exists
        const outDir = path.dirname(out);
        await fs.promises.mkdir(outDir, { recursive: true });
        const summary = scanCoverage({ repoPath: repo, maxBytes, excludeGlobs: exclude });
        const report = {
          schema_version: 'coverage_report_v1',
          repo_path: repo,
          commit_sha: commitSha,
          generated_at: new Date().toISOString(),
          summary,
        };
        await fs.promises.writeFile(out, JSON.stringify(report, null, 2));
        console.log(`WROTE: ${out}`);
        process.exitCode = 0;
      } catch (err) {
        if (err instanceof Error) {
          console.error('Coverage failed:', err.message);
        } else {
          console.error('Coverage failed:', err);
        }
        process.exitCode = 2;
      }
    }
  );
}
