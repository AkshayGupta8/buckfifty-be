import { normalizeUsPhoneToE164 } from "../utils/phoneNumber";

/**
 * Twilio Console Numbers
 *
 * Keeping this in one place makes it easy to add/remove numbers.
 *
 * The console routes accept digits-only path params (e.g. 7209642185),
 * but we normalize to E.164 internally for Twilio API calls.
 */

export type TwilioConsoleNumber = {
  /** Digits-only, 10-digit US number (no country code). */
  digits: string;
  /** Human friendly label shown in the UI (optional). */
  label: string;
};

export const TWILIO_CONSOLE_NUMBERS: TwilioConsoleNumber[] = [
  { digits: "8446042431", label: "Larry Buck" },
  { digits: "4632170238", label: "Curly Buck" },
  { digits: "7755216885", label: "Moe Buck" },
  { digits: "5074282550", label: "Buck Fifty AI Assistant" },
];

export function consoleDigitsToE164(digits: string): string {
  // digits are 10-digit US numbers; normalize helper can accept this.
  return normalizeUsPhoneToE164(digits);
}

export function isAllowedConsoleNumberDigits(digits: string): boolean {
  return TWILIO_CONSOLE_NUMBERS.some((n) => n.digits === digits);
}

export function getDigitsLabel(digits: string): string {
  const entry = TWILIO_CONSOLE_NUMBERS.find((n) => n.digits === digits);
  if (!entry) {
    throw new Error(`Unknown console number: ${digits}`);
  }
  return entry.label;
}
