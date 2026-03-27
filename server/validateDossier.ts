import type { Argv } from "yargs";
import * as fs from "fs";
import Ajv from "ajv";

export function registerValidateDossier(y: Argv) {
  return y.command(
    "validate-dossier <dossier>",
    "Validate dossier.json against v2 schema",
    (cmd) =>
      cmd.option("schema", {
        type: "string",
        describe: "Path to schema file",
        default: "shared/schemas/dossier_v2.schema.json",
      }),
    async (args) => {
      const dossierPath = args.dossier as string;
      const schemaPath = args.schema as string;
      let dossier, schema;
      try {
        dossier = JSON.parse(fs.readFileSync(dossierPath, "utf8"));
      } catch (e) {
        console.error("ERROR: Failed to load dossier.");
        process.exitCode = 1;
        return;
      }
      try {
        schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
      } catch (e) {
        console.error("ERROR: Failed to load schema.");
        process.exitCode = 1;
        return;
      }
      const ajv = new Ajv({ strict: false });
      const validate = ajv.compile(schema);
      const valid = validate(dossier);
      if (!valid) {
        console.error("Validation failed:", validate.errors);
        process.exitCode = 2;
        return;
      }
      console.log("Dossier is valid.");
      process.exitCode = 0;
    }
  );
}
