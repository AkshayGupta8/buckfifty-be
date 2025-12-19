export type TwilioInboundWebhookBody = {
  From?: string;
  To?: string;
  Body?: string;
  MessageSid?: string;
};

export type InboundTwilioMessageContext = {
  userId: string;
  from: string;
  to?: string;
  body: string;
  messageSid: string;
  conversationId: string;
  conversationMessageId?: string;
};
