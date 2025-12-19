/*
  Warnings:

  - A unique constraint covering the columns `[event_id,member_id]` on the table `Conversation` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."Conversation" ADD COLUMN     "event_id" UUID,
ADD COLUMN     "member_id" UUID,
ALTER COLUMN "user_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Conversation_event_id_idx" ON "public"."Conversation"("event_id");

-- CreateIndex
CREATE INDEX "Conversation_member_id_idx" ON "public"."Conversation"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_event_id_member_id_key" ON "public"."Conversation"("event_id", "member_id");

-- AddForeignKey
ALTER TABLE "public"."Conversation" ADD CONSTRAINT "Conversation_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."Event"("event_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Conversation" ADD CONSTRAINT "Conversation_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."Member"("member_id") ON DELETE CASCADE ON UPDATE CASCADE;
