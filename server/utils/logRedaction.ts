/** Strip control / line-break characters that confuse log aggregators (log injection). */
export function redactForLog(input: string, maxChars = 16_000): string {
  return input
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "␤")
    .slice(0, maxChars);
}
