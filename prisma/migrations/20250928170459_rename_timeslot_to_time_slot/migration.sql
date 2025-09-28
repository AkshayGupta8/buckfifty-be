/*
  Warnings:

  - You are about to drop the `Timeslot` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "public"."TimeSlotStatus" AS ENUM ('invites', 'suggested', 'accepted', 'declined');

-- DropForeignKey
ALTER TABLE "public"."Timeslot" DROP CONSTRAINT "Timeslot_event_id_fkey";

-- DropTable
DROP TABLE "public"."Timeslot";

-- DropEnum
DROP TYPE "public"."TimeslotStatus";

-- CreateTable
CREATE TABLE "public"."TimeSlot" (
    "time_slot_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "start_time" TIMESTAMPTZ(6) NOT NULL,
    "end_time" TIMESTAMPTZ(6) NOT NULL,
    "status" "public"."TimeSlotStatus" NOT NULL DEFAULT 'suggested',

    CONSTRAINT "TimeSlot_pkey" PRIMARY KEY ("time_slot_id")
);

-- CreateIndex
CREATE INDEX "TimeSlot_event_id_idx" ON "public"."TimeSlot"("event_id");

-- AddForeignKey
ALTER TABLE "public"."TimeSlot" ADD CONSTRAINT "TimeSlot_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."Event"("event_id") ON DELETE CASCADE ON UPDATE CASCADE;
