import { Twilio } from "twilio";

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

export async function sendSms(to: string, body: string): Promise<string> {
  try {
    const message = await client.messages.create({
      body,
      from: fromNumber,
      to,
    });
    console.log(`Message sent successfully. SID: ${message.sid}`);
    return message.sid;
  } catch (error) {
    console.error("Failed to send message via Twilio:", error);
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

    console.log(`MMS sent successfully. SID: ${message.sid}`);
    return message.sid;
  } catch (error) {
    console.error("Failed to send MMS via Twilio:", error);
    throw error;
  }
}
