import type { Argv } from "yargs";
import { hashClaimExcerpt } from "./claims/hash";
import * as fs from "fs";

export function registerVerifyClaim(y: Argv) {
  return y.command(
    "verify-claim <claim_id>",
    "Verify a single claim hash against a repo snapshot",
    (cmd) =>
      cmd
        .positional("claim_id", { type: "string", demandOption: true })
        .option("repo-path", { type: "string", demandOption: true })
        .option("dossier", { type: "string", default: "dossier.json" }),
    async (args) => {
      const dossierPath = args.dossier as string;
      const repoPath = args["repo-path"] as string;
      const claimId = args.claim_id as string;
      let dossier;
      try {
        dossier = JSON.parse(fs.readFileSync(dossierPath, "utf8"));
      } catch (e) {
        console.error("ERROR: Failed to load dossier.");
        process.exitCode = 3;
        return;
      }
      const claim = dossier.claims.find((c: any) => c.claim_id === claimId);
      if (!claim) {
        console.error("ERROR: Claim not found.");
        process.exitCode = 3;
        return;
      }
      const filePath = `${repoPath}/${claim.file}`;
      const result = hashClaimExcerpt(filePath, claim.line_start, claim.line_end);
      if (result.error) {
        console.error(`ERROR: ${result.error}`);
        process.exitCode = 3;
        return;
      }
      console.log(`Expected Hash: ${claim.excerpt_hash}`);
      console.log(`Computed Hash: ${result.excerptHash}`);
      const verdict = claim.excerpt_hash === result.excerptHash ? "MATCH" : "MISMATCH";
      console.log(`Verdict: ${verdict}`);
      if (result.canonicalExcerpt) {
        const lines = result.canonicalExcerpt.split("\n");
        if (lines.length <= 200) {
          console.log("Canonical Excerpt:\n" + result.canonicalExcerpt);
        } else {
          console.log("Canonical Excerpt (head/tail):");
          console.log(lines.slice(0, 100).join("\n"));
          console.log("...\n...");
          console.log(lines.slice(-100).join("\n"));
        }
      }
      process.exitCode = verdict === "MATCH" ? 0 : 2;
    }
  );
}
