/**
 * Normalizes a US (+1) phone number to E.164 format: +1XXXXXXXXXX
 *
 * Rules:
 * - Strip all non-digit characters
 * - Accept 10-digit US numbers (assumed country code +1)
 * - Accept 11-digit numbers starting with "1" (drop the leading 1)
 * - Otherwise throw an error
 */
export function normalizeUsPhoneToE164(input: string): string {
  const raw = input.trim();
  const digits = raw.replace(/\D/g, "");

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1${digits.slice(1)}`;
  }

  throw new Error(`Invalid US phone number: "${input}"`);
}
