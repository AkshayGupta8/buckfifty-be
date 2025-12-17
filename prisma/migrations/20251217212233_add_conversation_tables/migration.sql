-- CreateEnum
CREATE TYPE "public"."MessageRole" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "public"."MessageDirection" AS ENUM ('inbound', 'outbound');

-- CreateTable
CREATE TABLE "public"."Conversation" (
    "conversation_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "state" JSONB,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("conversation_id")
);

-- CreateTable
CREATE TABLE "public"."ConversationMessage" (
    "message_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "role" "public"."MessageRole" NOT NULL,
    "direction" "public"."MessageDirection" NOT NULL,
    "content" TEXT NOT NULL,
    "twilio_sid" TEXT,
    "attributes" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("message_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_user_id_key" ON "public"."Conversation"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_twilio_sid_key" ON "public"."ConversationMessage"("twilio_sid");

-- CreateIndex
CREATE INDEX "ConversationMessage_conversation_id_created_at_idx" ON "public"."ConversationMessage"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "public"."Conversation" ADD CONSTRAINT "Conversation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."Conversation"("conversation_id") ON DELETE CASCADE ON UPDATE CASCADE;
