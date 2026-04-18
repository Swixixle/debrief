import fs from "node:fs";
import fsP from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertRealPathUnderBase } from "../utils/pathSanitizer";
import { ingestMultipartStagingDir } from "./stagingPaths";

const WHISPER_MODEL = "whisper-1";

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

async function resolveSafeAudioPath(filePath: string): Promise<string> {
  const baseReal = await fsP.realpath(path.resolve(ingestMultipartStagingDir()));
  const candidate = path.resolve(baseReal, filePath);
  let safeReal: string;
  try {
    safeReal = await fsP.realpath(candidate);
    await assertRealPathUnderBase(safeReal, baseReal);
  } catch {
    throw new Error("Audio path must be under the server upload staging directory");
  }
  if (safeReal !== baseReal && !safeReal.startsWith(`${baseReal}${path.sep}`)) {
    throw new Error("Audio path must be under the server upload staging directory");
  }
  return safeReal;
}

export async function sha256File(filePath: string): Promise<string> {
  const safePath = await resolveSafeAudioPath(filePath);
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const s = fs.createReadStream(safePath);
    s.on("data", (chunk: Buffer | string) => hash.update(chunk));
    s.on("end", () => resolve());
    s.on("error", reject);
  });
  return `sha256:${hash.digest("hex")}`;
}

/** Whisper via multipart fetch (OpenAI-compatible endpoint). */
export async function transcribeAudio(filePath: string): Promise<string> {
  const safePath = await resolveSafeAudioPath(filePath);
  const buf = await fsP.readFile(safePath);
  const formData = new FormData();
  formData.append("file", new File([buf], path.basename(safePath), { type: "application/octet-stream" }));
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
): Promise<{ transcript: string; audioHash: string }> {
  const [transcript, audioHash] = await Promise.all([transcribeAudio(audioPath), sha256File(audioPath)]);
  const now = new Date().toISOString();
  const description = [
    "# Voice description (transcribed)",
    "",
    "⚠️ **(INFERRED)** This analysis is based on your voice description, not source code.",
    "All claims are INFERRED until you connect a repository.",
    "",
    transcript,
  ].join("\n");
  await fsP.writeFile(path.join(destDir, "description.md"), description, "utf8");
  await fsP.writeFile(
    path.join(destDir, "audio_manifest.json"),
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
    "utf8",
  );
  return { transcript, audioHash };
}

/** @deprecated use transcribeAudio */
export async function transcribeAudioFile(audioPath: string): Promise<string> {
  return transcribeAudio(audioPath);
}

export async function ingestAudioToText(audioPath: string): Promise<string> {
  return transcribeAudio(audioPath);
}
