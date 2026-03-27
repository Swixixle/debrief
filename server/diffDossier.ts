import { Argv } from 'yargs';
import { diffDossier } from "./claims/diffDossier";

export function registerDiffDossier(y: Argv) {
  y.command(
    'diff-dossier',
    'Compare two dossier files and output longitudinal UNKNOWNs, commit delta, and trust signals.',
    (yargs) =>
      yargs
        .option('old', {
          type: 'string',
          demandOption: true,
          describe: 'Path to old dossier file',
        })
        .option('new', {
          type: 'string',
          demandOption: true,
          describe: 'Path to new dossier file',
        })
        .option('out', {
          type: 'string',
          demandOption: false,
          describe: 'Path to output diff file (default: diff_dossier.json)',
          default: 'diff_dossier.json',
        }),
    async (argv) => {
      const { old, new: newDossier, out } = argv;
      const result = diffDossier(old, newDossier, out);
      console.log('Diff dossier written to', out);
      console.log(JSON.stringify(result, null, 2));
    }
  );
}
