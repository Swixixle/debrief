// Claim hashing and verification plumbing for Repo Recon
import { canonicalizeExcerptV1, CanonicalizationResult } from '../canon/index';
import { createHash } from 'crypto';
import { Buffer } from 'buffer';
import * as fs from 'fs';

export type ClaimHashResult = {
  excerptHash?: string;
  canonicalizationVersion: string;
  hashAlgorithm: string;
  hashEncoding: string;
  canonicalExcerpt?: string;
  error?: string;
};

/**
 * Extracts file lines, canonicalizes, hashes excerpt.
 * @param filePath Path to file
 * @param startLine 1-indexed start line
 * @param endLine 1-indexed end line (inclusive)
 * @returns ClaimHashResult
 */
export function hashClaimExcerpt(
  filePath: string,
  startLine: number,
  endLine: number
): ClaimHashResult {
  let fileBytes: Buffer;
  try {
    fileBytes = fs.readFileSync(filePath);
  } catch (e) {
    return { error: 'FILE_MISSING', canonicalizationVersion: 'v1', hashAlgorithm: 'sha256', hashEncoding: 'hex' };
  }

  const canon: CanonicalizationResult = canonicalizeExcerptV1(fileBytes, startLine, endLine);
  if (canon.error) {
    return { error: canon.error, canonicalizationVersion: 'v1', hashAlgorithm: 'sha256', hashEncoding: 'hex' };
  }

  const hash = createHash('sha256');
  hash.update(Buffer.from(canon.excerpt, 'utf8'));
  const excerptHash = hash.digest('hex');

  return {
    excerptHash,
    canonicalizationVersion: 'v1',
    hashAlgorithm: 'sha256',
    hashEncoding: 'hex',
    canonicalExcerpt: canon.excerpt
  };
}
