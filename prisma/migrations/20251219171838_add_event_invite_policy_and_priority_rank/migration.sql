/*
  Warnings:

  - A unique constraint covering the columns `[event_id,member_id]` on the table `EventMember` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "public"."EventInvitePolicy" AS ENUM ('max_only', 'prioritized', 'exact');

-- AlterTable
ALTER TABLE "public"."Event" ADD COLUMN     "invite_policy" "public"."EventInvitePolicy" NOT NULL DEFAULT 'max_only';

-- AlterTable
ALTER TABLE "public"."EventMember" ADD COLUMN     "priority_rank" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "EventMember_event_id_member_id_key" ON "public"."EventMember"("event_id", "member_id");
