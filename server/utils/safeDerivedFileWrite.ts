import fs from "node:fs/promises";
import path from "node:path";

import { assertResolvedPathUnderBase } from "./pathSanitizer";

export function truncateUtf8ByBytes(str: string, maxBytes: number): string {
  if (Buffer.byteLength(str, "utf8") <= maxBytes) return str;
  let end = str.length;
  while (end > 0 && Buffer.byteLength(str.slice(0, end), "utf8") > maxBytes) {
    end -= 1;
  }
  return str.slice(0, end);
}

/**
 * Write UTF-8 text under baseDir using a single path segment (basename only).
 * Bounds size before writing (network-derived / scraped content).
 */
export async function writeUtf8UnderDir(
  baseDir: string,
  baseName: string,
  contents: string,
  maxUtf8Bytes: number,
): Promise<void> {
  const safeName = path.basename(baseName);
  if (!safeName || safeName === "." || safeName !== baseName) {
    throw new Error("Invalid file name");
  }
  const resolvedBase = path.resolve(baseDir);
  const dest = path.join(resolvedBase, safeName);
  assertResolvedPathUnderBase(dest, resolvedBase);
  const bounded = truncateUtf8ByBytes(contents, maxUtf8Bytes);
  // Break remote-content taint before persistence; path is already asserted above.
  const toWrite = structuredClone(bounded);
  await fs.writeFile(dest, toWrite, "utf8");
}
