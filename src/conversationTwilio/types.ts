export type TwilioInboundWebhookBody = {
  From?: string;
  To?: string;
  Body?: string;
  MessageSid?: string;
};

export type InboundTwilioMessageContext = {
  /** The owning user for this inbound message (always resolvable). */
  userId: string;

  /** Who sent the SMS into Twilio. */
  from: string;
  to?: string;
  body: string;
  messageSid: string;

  /** Conversation the message was persisted into (user conversation or event-member conversation). */
  conversationId: string;
  conversationMessageId?: string;

  /**
   * Sender classification (used for routing).
   * - user: from=User.phone_number
   * - member: from=Member.phone_number
   */
  senderType: "user" | "member";

  /** Present only when senderType === "member". */
  memberId?: string;

  /** Present only when senderType === "member" (the inferred event being discussed). */
  eventId?: string;
};
