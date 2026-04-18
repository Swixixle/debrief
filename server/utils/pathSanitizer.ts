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
 *
 * @returns Canonical filesystem path safe to pass to read/copy/unlink after success.
 */
export async function assertRealPathUnderBase(candidatePath: string, baseDir: string): Promise<string> {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(candidatePath);
  let baseReal: string;
  try {
    baseReal = await fs.realpath(base);
  } catch {
    baseReal = base;
  }
  try {
    // Symlink resolution: candidateReal must remain under baseReal (checked below).
    const candidateReal = await fs.realpath(resolved);
    const rel = path.relative(baseReal, candidateReal);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("Path not under allowed directory");
    }
    return candidateReal;
  } catch (err) {
    if (err instanceof Error && err.message === "Path not under allowed directory") {
      throw err;
    }
    assertResolvedPathUnderBase(candidatePath, baseDir);
    return resolved;
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
  const verifiedSource = await assertRealPathUnderBase(multerPath, uploadBaseDir);
  const safeName = `q-${Date.now()}-${randomBytes(12).toString("hex")}`;
  const resolvedBase = path.resolve(uploadBaseDir);
  const dest = path.join(resolvedBase, safeName);
  assertResolvedPathUnderBase(dest, resolvedBase);
  await fs.copyFile(verifiedSource, dest);
  await fs.unlink(verifiedSource);
  return dest;
}

/** Best-effort unlink of a multer temp file only when it resolves under the upload base. */
export async function unlinkOptionalMulterFile(
  multerPath: string | undefined,
  uploadBaseDir: string,
): Promise<void> {
  if (!multerPath) return;
  try {
    const p = await assertRealPathUnderBase(multerPath, uploadBaseDir);
    await fs.unlink(p);
  } catch {
    /* ignore */
  }
}
