// Canonicalization v1 implementation for Repo Recon
// Deterministic across OS, explicit encoding, newline handling, BOM removal, trailing whitespace trimming

import { Buffer } from 'buffer';

export type CanonicalizationResult = {
  excerpt: string;
  error?: 'ENCODING_ERROR' | 'EXCERPT_TOO_LARGE';
};

const MAX_EXCERPT_SIZE = 128 * 1024; // 128 KB
const UTF8_BOM = '\uFEFF';

/**
 * Canonicalize lines according to Canonicalization v1 spec.
 * @param fileBytes Buffer of file bytes
 * @param startLine 1-indexed start line
 * @param endLine 1-indexed end line (inclusive)
 * @returns CanonicalizationResult
 */
export function canonicalizeExcerptV1(
  fileBytes: Buffer,
  startLine: number,
  endLine: number
): CanonicalizationResult {
  let text: string;
  try {
    text = fileBytes.toString('utf8');
  } catch (e) {
    return { excerpt: '', error: 'ENCODING_ERROR' };
  }

  // Universal newline split
  const lines = text.replace(/\r\n|\r|\n/g, '\n').split('\n');

  // 1-indexed lines
  const excerptLines = lines.slice(startLine - 1, endLine);

  // Remove BOM from first line
  if (excerptLines.length > 0 && excerptLines[0].startsWith(UTF8_BOM)) {
    excerptLines[0] = excerptLines[0].replace(UTF8_BOM, '');
  }

  // Trim trailing whitespace per line
  const canonLines = excerptLines.map(line => line.replace(/[ \t]+$/g, ''));

  // Join with \n, enforce final newline
  let canonicalExcerpt = canonLines.join('\n') + '\n';

  // Enforce max size
  const excerptBytes = Buffer.from(canonicalExcerpt, 'utf8');
  if (excerptBytes.length > MAX_EXCERPT_SIZE) {
    return { excerpt: '', error: 'EXCERPT_TOO_LARGE' };
  }

  return { excerpt: canonicalExcerpt };
}
