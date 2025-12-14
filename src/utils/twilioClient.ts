import { Twilio } from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
const authToken = process.env.TWILIO_AUTH_TOKEN || "";
const fromNumber = process.env.TWILIO_FROM_NUMBER || "";

if (!accountSid || !authToken || !fromNumber) {
  throw new Error("Twilio credentials are not set in environment variables");
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
