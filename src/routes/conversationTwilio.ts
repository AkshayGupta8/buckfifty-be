import { Router } from "express";
import { twilioWebhookHandler } from "../conversationTwilio/webhookHandler";

const router = Router();

// Twilio inbound webhook
router.post("/webhook", twilioWebhookHandler);

export default router;
