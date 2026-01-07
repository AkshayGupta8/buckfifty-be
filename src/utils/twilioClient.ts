import { Twilio } from "twilio";
import logger from "./logger";

const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
const authToken = process.env.TWILIO_AUTH_TOKEN || "";

const isDev = process.env.DEV === "1";
const fromNumber = (isDev
  ? process.env.DEV_TWILIO_FROM_NUMBER
  : process.env.TWILIO_FROM_NUMBER) || "";

const missingVars: string[] = [];
if (!accountSid) missingVars.push("TWILIO_ACCOUNT_SID");
if (!authToken) missingVars.push("TWILIO_AUTH_TOKEN");
if (!fromNumber) {
  missingVars.push(isDev ? "DEV_TWILIO_FROM_NUMBER" : "TWILIO_FROM_NUMBER");
}

if (missingVars.length > 0) {
  throw new Error(
    `Twilio env vars missing: ${missingVars.join(", ")}. (DEV=${process.env.DEV || ""})`
  );
}

const client = new Twilio(accountSid, authToken);

export type TwilioMessageSummary = {
  sid: string;
  direction?: string;
  from: string;
  to: string;
  body?: string | null;
  status?: string;
  dateCreated?: string;
};

export async function sendSms(to: string, body: string): Promise<string> {
  try {
    const message = await client.messages.create({
      body,
      from: fromNumber,
      to,
    });
    // Use logger so message sends are correlated with requestId/conversationId.
    logger.info("twilio.sms.sent", { messageSid: message.sid });
    return message.sid;
  } catch (error) {
    logger.error("twilio.sms.failed", { error });
    throw error;
  }
}

/** Send an SMS from a specific Twilio number (E.164). */
export async function sendSmsFrom(from: string, to: string, body: string): Promise<string> {
  try {
    const message = await client.messages.create({ body, from, to });
    logger.info("twilio.sms.sent", { messageSid: message.sid, from });
    return message.sid;
  } catch (error) {
    logger.error("twilio.sms.failed", { error, from });
    throw error;
  }
}

export async function sendMms(
  to: string,
  body: string,
  mediaUrl: string | string[],
): Promise<string> {
  try {
    const message = await client.messages.create({
      body,
      from: fromNumber,
      to,
      mediaUrl: Array.isArray(mediaUrl) ? mediaUrl : [mediaUrl],
    });

    logger.info("twilio.mms.sent", { messageSid: message.sid });
    return message.sid;
  } catch (error) {
    logger.error("twilio.mms.failed", { error });
    throw error;
  }
}

/** Send an MMS from a specific Twilio number (E.164). */
export async function sendMmsFrom(
  from: string,
  to: string,
  body: string,
  mediaUrl: string | string[],
): Promise<string> {
  try {
    const message = await client.messages.create({
      body,
      from,
      to,
      mediaUrl: Array.isArray(mediaUrl) ? mediaUrl : [mediaUrl],
    });

    logger.info("twilio.mms.sent", { messageSid: message.sid, from });
    return message.sid;
  } catch (error) {
    logger.error("twilio.mms.failed", { error, from });
    throw error;
  }
}

/**
 * Lists recent messages associated with a Twilio number by polling Twilio's API.
 *
 * We query both inbound (to=number) and outbound (from=number) and merge results.
 */
export async function listMessagesForNumber(
  phoneE164: string,
  limit = 50,
): Promise<TwilioMessageSummary[]> {
  // Twilio's list API supports filtering by "to" and "from".
  // We query both to show a full chat-like timeline.
  const [inbound, outbound] = await Promise.all([
    client.messages.list({ to: phoneE164, limit }),
    client.messages.list({ from: phoneE164, limit }),
  ]);

  const bySid = new Map<string, TwilioMessageSummary>();
  for (const m of [...inbound, ...outbound]) {
    bySid.set(m.sid, {
      sid: m.sid,
      direction: m.direction,
      from: m.from,
      to: m.to,
      body: m.body,
      status: m.status,
      dateCreated: m.dateCreated ? m.dateCreated.toISOString() : undefined,
    });
  }

  return Array.from(bySid.values()).sort((a, b) => {
    const aT = a.dateCreated ? Date.parse(a.dateCreated) : 0;
    const bT = b.dateCreated ? Date.parse(b.dateCreated) : 0;
    return aT - bT;
  });
}
