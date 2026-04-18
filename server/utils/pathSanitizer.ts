import path from "node:path";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";

/**
 * Sanitize a user-supplied identifier for use in filesystem paths.
 * Only allows alphanumeric characters, hyphens, underscores, and dots.
 * Prevents path traversal attacks (when used for path segments, not full paths).
 */
export function sanitizePathSegment(input: string): string {
  const sanitized = input
    .replace(/\.\./g, "")
    .replace(/[/\\]/g, "")
    .replace(/[^a-zA-Z0-9\-_.]/g, "");

  if (!sanitized) {
    throw new Error("Invalid path segment after sanitization");
  }

  return sanitized;
}

/**
 * Safely join a base directory with a user-supplied segment.
 * Verifies the result stays within the base directory.
 */
export function safeJoin(baseDir: string, userSegment: string): string {
  const sanitized = sanitizePathSegment(userSegment);
  const resolved = path.resolve(baseDir, sanitized);
  const base = path.resolve(baseDir);
  const rel = path.relative(base, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

/**
 * Ensure a concrete file path (e.g. multer output) resolves inside an expected directory.
 */
export function assertResolvedPathUnderBase(candidatePath: string, baseDir: string): void {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(candidatePath);
  const rel = path.relative(base, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path not under allowed directory");
  }
}

/**
 * Like {@link assertResolvedPathUnderBase}, but resolves symlinks so a path under `baseDir`
 * cannot point at files outside via symlink (TOCTOU-hardening for ingest files).
 */
export async function assertRealPathUnderBase(candidatePath: string, baseDir: string): Promise<void> {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(candidatePath);
  let baseReal: string;
  try {
    baseReal = await fs.realpath(base);
  } catch {
    baseReal = base;
  }
  let candidateReal: string;
  try {
    // codeql[js/path-injection]: realpath is used for symlink resolution; the result is rejected unless it stays under baseReal (see relative-path check below).
    candidateReal = await fs.realpath(resolved);
  } catch {
    assertResolvedPathUnderBase(candidatePath, baseDir);
    return;
  }
  const rel = path.relative(baseReal, candidateReal);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path not under allowed directory");
  }
}

/**
 * After verifying a multer temp path is under uploadBaseDir, copy bytes to a server-chosen name
 * so downstream paths are not multer-controlled (CodeQL path-injection hygiene).
 */
export async function quarantineVerifiedUpload(
  multerPath: string,
  uploadBaseDir: string,
): Promise<string> {
  await assertRealPathUnderBase(multerPath, uploadBaseDir);
  const safeName = `q-${Date.now()}-${randomBytes(12).toString("hex")}`;
  const dest = path.join(uploadBaseDir, safeName);
  assertResolvedPathUnderBase(dest, uploadBaseDir);
  await fs.copyFile(multerPath, dest);
  await fs.unlink(multerPath).catch(() => {});
  return dest;
}
