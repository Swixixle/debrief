import crypto from "crypto";
import { z } from "zod";
import type { Analysis } from "@shared/schema";

const looseSummary = z.record(z.string(), z.unknown());

/** Strict shape + size bounds for public POST /api/certificates/verify (no reliance on loose req.body). */
export const evidenceBundleVerifySchema = z
  .object({
    certificate_id: z.string().max(512),
    tenant_id: z.string().max(512),
    analysis_id: z.number().finite(),
    issued_at_utc: z.string().max(128),
    signature: z.object({
      algorithm: z.string().max(128),
      key_id: z.string().max(256),
      signature: z.string().max(500_000),
      canonical_message: z.string().max(500_000),
    }),
    hashes: z.object({
      note_hash: z.string().max(512),
      hash_algorithm: z.string().max(64),
    }),
    model_info: z.object({
      model_version: z.string().max(512).nullable(),
      prompt_version: z.string().max(512).nullable(),
      governance_policy_version: z.string().max(512).nullable(),
      policy_hash: z.string().max(512).nullable(),
    }),
    human_attestation: z.object({
      human_reviewed: z.boolean(),
      reviewer_hash: z.string().max(512).nullable(),
      ehr_referenced_at: z.string().max(256).nullable(),
    }),
    verification_instructions: z.object({
      steps: z.array(z.string().max(8000)).max(500),
    }),
    public_key_pem: z.string().max(500_000),
    analysis_data: z.object({
      dossier_excerpt: z.string().max(2_000_000),
      claims_count: z.number().finite(),
      coverage_summary: looseSummary,
      operate_summary: looseSummary,
    }),
  })
  .strict();

export interface EvidenceBundleOptions {
  analysisId: number;
  tenantId: string;
  analysis: Analysis;
  modelVersion?: string;
  promptVersion?: string;
  governancePolicyVersion?: string;
  humanReviewed?: boolean;
  reviewerHash?: string;
  ehrReferencedAt?: string;
}

export interface EvidenceBundle {
  certificate_id: string;
  tenant_id: string;
  analysis_id: number;
  issued_at_utc: string;
  signature: {
    algorithm: string;
    key_id: string;
    signature: string;
    canonical_message: string;
  };
  hashes: {
    note_hash: string;
    hash_algorithm: string;
  };
  model_info: {
    model_version: string | null;
    prompt_version: string | null;
    governance_policy_version: string | null;
    policy_hash: string | null;
  };
  human_attestation: {
    human_reviewed: boolean;
    reviewer_hash: string | null;
    ehr_referenced_at: string | null;
  };
  verification_instructions: {
    steps: string[];
  };
  public_key_pem: string;
  analysis_data: {
    dossier_excerpt: string;
    claims_count: number;
    coverage_summary: any;
    operate_summary: any;
  };
}

/**
 * Generate a per-tenant RSA key pair for signing evidence bundles
 * In production, these would be stored securely per tenant
 */
export function generateTenantKeyPair(): { privateKey: string; publicKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });
  
  return { privateKey, publicKey };
}

/**
 * Hash analysis content for evidence bundle
 */
export function hashAnalysisContent(analysis: Analysis): string {
  const content = JSON.stringify({
    dossier: analysis.dossier,
    claims: analysis.claims,
    operate: analysis.operate,
    coverage: analysis.coverage,
  });
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Create canonical message for signing
 */
export function createCanonicalMessage(bundle: Partial<EvidenceBundle>): string {
  return JSON.stringify({
    certificate_id: bundle.certificate_id,
    tenant_id: bundle.tenant_id,
    analysis_id: bundle.analysis_id,
    issued_at_utc: bundle.issued_at_utc,
    note_hash: bundle.hashes?.note_hash,
  }, null, 0);
}

/**
 * Sign the canonical message with the tenant's private key
 */
export function signMessage(canonicalMessage: string, privateKey: string): string {
  const sign = crypto.createSign("SHA256");
  sign.update(canonicalMessage);
  sign.end();
  return sign.sign(privateKey, "base64");
}

/**
 * Verify a signature using the public key
 */
export function verifySignature(
  canonicalMessage: string,
  signature: string,
  publicKey: string
): boolean {
  try {
    const verify = crypto.createVerify("SHA256");
    verify.update(canonicalMessage);
    verify.end();
    return verify.verify(publicKey, signature, "base64");
  } catch (error) {
    console.error("Signature verification error:", error);
    return false;
  }
}

/**
 * Generate a complete evidence bundle with signature
 */
export function generateEvidenceBundle(
  certificateId: string,
  options: EvidenceBundleOptions,
  privateKey: string,
  publicKey: string
): EvidenceBundle {
  const issuedAt = new Date().toISOString();
  const noteHash = hashAnalysisContent(options.analysis);
  
  // Create policy hash if governance version is provided
  const policyHash = options.governancePolicyVersion
    ? crypto.createHash("sha256")
        .update(options.governancePolicyVersion)
        .digest("hex")
    : null;
  
  // Build the bundle structure
  const partialBundle: Partial<EvidenceBundle> = {
    certificate_id: certificateId,
    tenant_id: options.tenantId,
    analysis_id: options.analysisId,
    issued_at_utc: issuedAt,
    hashes: {
      note_hash: noteHash,
      hash_algorithm: "sha256",
    },
  };
  
  // Create canonical message and sign it
  const canonicalMessage = createCanonicalMessage(partialBundle);
  const signature = signMessage(canonicalMessage, privateKey);
  
  // Extract key ID from public key (first 16 chars of hash)
  const keyId = crypto
    .createHash("sha256")
    .update(publicKey)
    .digest("hex")
    .substring(0, 16);
  
  // Build complete bundle
  const bundle: EvidenceBundle = {
    certificate_id: certificateId,
    tenant_id: options.tenantId,
    analysis_id: options.analysisId,
    issued_at_utc: issuedAt,
    signature: {
      algorithm: "RSA-SHA256",
      key_id: keyId,
      signature,
      canonical_message: canonicalMessage,
    },
    hashes: {
      note_hash: noteHash,
      hash_algorithm: "sha256",
    },
    model_info: {
      model_version: options.modelVersion || null,
      prompt_version: options.promptVersion || null,
      governance_policy_version: options.governancePolicyVersion || null,
      policy_hash: policyHash,
    },
    human_attestation: {
      human_reviewed: options.humanReviewed || false,
      reviewer_hash: options.reviewerHash || null,
      ehr_referenced_at: options.ehrReferencedAt || null,
    },
    verification_instructions: {
      steps: [
        "1. Extract the canonical_message from signature object",
        "2. Extract the signature from signature object",
        "3. Extract the public_key_pem from the bundle",
        "4. Verify signature using: openssl dgst -sha256 -verify <public_key_file> -signature <signature_file> <canonical_message_file>",
        "5. Alternatively, use the verify() function from this module programmatically",
        "6. Verify that note_hash matches hash of analysis content",
      ],
    },
    public_key_pem: publicKey,
    analysis_data: {
      dossier_excerpt: options.analysis.dossier
        ? options.analysis.dossier.substring(0, 500) + "..."
        : "",
      claims_count: Array.isArray(options.analysis.claims)
        ? options.analysis.claims.length
        : 0,
      coverage_summary: options.analysis.coverage || {},
      operate_summary: options.analysis.operate
        ? {
            boot: (options.analysis.operate as any).boot || {},
            integrate: (options.analysis.operate as any).integrate || {},
            deploy: (options.analysis.operate as any).deploy || {},
            readiness: (options.analysis.operate as any).readiness || {},
          }
        : {},
    },
  };
  
  return bundle;
}

/**
 * Verify an evidence bundle's signature
 */
export function verifyEvidenceBundle(bundle: EvidenceBundle): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  try {
    // Verify signature
    const signatureValid = verifySignature(
      bundle.signature.canonical_message,
      bundle.signature.signature,
      bundle.public_key_pem
    );
    
    if (!signatureValid) {
      errors.push("Signature verification failed");
    }
    
    // Verify canonical message matches bundle data
    const expectedCanonical = createCanonicalMessage({
      certificate_id: bundle.certificate_id,
      tenant_id: bundle.tenant_id,
      analysis_id: bundle.analysis_id,
      issued_at_utc: bundle.issued_at_utc,
      hashes: bundle.hashes,
    });
    
    if (expectedCanonical !== bundle.signature.canonical_message) {
      errors.push("Canonical message does not match bundle data");
    }
    
    // Verify key ID matches public key
    const expectedKeyId = crypto
      .createHash("sha256")
      .update(bundle.public_key_pem)
      .digest("hex")
      .substring(0, 16);
    
    if (expectedKeyId !== bundle.signature.key_id) {
      errors.push("Key ID does not match public key");
    }
    
    return {
      valid: errors.length === 0,
      errors,
    };
  } catch (error) {
    errors.push(`Verification error: ${error}`);
    return { valid: false, errors };
  }
}
