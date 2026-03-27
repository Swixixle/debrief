import { Argv } from 'yargs';
import { monitorDrift } from "./claims/monitorDrift";

export function registerMonitor(y: Argv) {
  y.command(
    'monitor <repo>',
    'Run longitudinal drift analysis comparing HEAD to baseline dossier.',
    (yargs) =>
      yargs
        .positional('repo', {
          type: 'string',
          describe: 'Path to git repo',
        })
        .option('baseline', {
          type: 'string',
          demandOption: true,
          describe: 'Path to baseline dossier_v2 JSON',
        })
        .option('out', {
          type: 'string',
          demandOption: true,
          describe: 'Path to output drift report JSON',
        }),
    async (argv) => {
      try {
        const repo = typeof argv.repo === 'string' ? argv.repo : '';
        const baseline = typeof argv.baseline === 'string' ? argv.baseline : '';
        const out = typeof argv.out === 'string' ? argv.out : '';
        const result = await monitorDrift({
          repoPath: repo,
          baselinePath: baseline,
          outPath: out,
        });
        console.log('Drift report written to', out);
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
      } catch (err) {
        if (err instanceof Error) {
          console.error('Monitor failed:', err.message);
        } else {
          console.error('Monitor failed:', err);
        }
        process.exit(2);
      }
    }
  );
}
