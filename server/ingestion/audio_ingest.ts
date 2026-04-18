import fs from "node:fs";
import fsP from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { assertResolvedPathUnderBase } from "../utils/pathSanitizer";
import { writeUtf8UnderDir } from "../utils/safeDerivedFileWrite";

const WHISPER_MODEL = "whisper-1";
const MAX_DESCRIPTION_MD_BYTES = 512 * 1024;
const MAX_AUDIO_MANIFEST_BYTES = 64 * 1024;

function openAiKey(): string {
  const k =
    process.env.OPENAI_API_KEY ||
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
    process.env.DEBRIEF_OPENAI_API_KEY;
  if (!k) {
    throw new Error(
      "OPENAI_API_KEY (or deprecated AI_INTEGRATIONS_OPENAI_API_KEY) required for audio transcription",
    );
  }
  return k;
}

export async function sha256File(filePath: string, allowedBaseDir: string): Promise<string> {
  assertResolvedPathUnderBase(path.resolve(filePath), path.resolve(allowedBaseDir));
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const s = fs.createReadStream(filePath);
    s.on("data", (chunk: Buffer | string) => hash.update(chunk));
    s.on("end", () => resolve());
    s.on("error", reject);
  });
  return `sha256:${hash.digest("hex")}`;
}

/** Whisper via multipart fetch (OpenAI-compatible endpoint). */
export async function transcribeAudio(filePath: string, allowedBaseDir: string): Promise<string> {
  assertResolvedPathUnderBase(path.resolve(filePath), path.resolve(allowedBaseDir));
  const buf = await fsP.readFile(filePath);
  const formData = new FormData();
  formData.append("file", new File([buf], path.basename(filePath), { type: "application/octet-stream" }));
  formData.append("model", WHISPER_MODEL);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiKey()}` },
    body: formData,
  });
  const data = (await response.json()) as { text?: string; error?: { message?: string } };
  if (!response.ok) {
    throw new Error(data?.error?.message || `transcription failed (${response.status})`);
  }
  const text = String(data.text || "").trim();
  if (!text) throw new Error("Transcription returned empty text");
  return text;
}

export async function writeAudioIngestArtifacts(
  destDir: string,
  audioPath: string,
  audioAllowedBaseDir: string,
): Promise<{ transcript: string; audioHash: string }> {
  const [transcript, audioHash] = await Promise.all([
    transcribeAudio(audioPath, audioAllowedBaseDir),
    sha256File(audioPath, audioAllowedBaseDir),
  ]);
  const now = new Date().toISOString();
  const description = [
    "# Voice description (transcribed)",
    "",
    "⚠️ **(INFERRED)** This analysis is based on your voice description, not source code.",
    "All claims are INFERRED until you connect a repository.",
    "",
    transcript,
  ].join("\n");
  await writeUtf8UnderDir(destDir, "description.md", description, MAX_DESCRIPTION_MD_BYTES);
  await writeUtf8UnderDir(
    destDir,
    "audio_manifest.json",
    JSON.stringify(
      {
        audio_hash: audioHash,
        transcribed_at: now,
        whisper_model: WHISPER_MODEL,
        transcript_length: transcript.length,
      },
      null,
      2,
    ),
    MAX_AUDIO_MANIFEST_BYTES,
  );
  return { transcript, audioHash };
}

/** @deprecated use transcribeAudio */
export async function transcribeAudioFile(
  audioPath: string,
  allowedBaseDir: string,
): Promise<string> {
  return transcribeAudio(audioPath, allowedBaseDir);
}

export async function ingestAudioToText(audioPath: string, allowedBaseDir: string): Promise<string> {
  return transcribeAudio(audioPath, allowedBaseDir);
}
