-- AlterTable
ALTER TABLE "public"."EventMember" ADD COLUMN     "invite_expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "invite_timed_out" BOOLEAN NOT NULL DEFAULT false;
