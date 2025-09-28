-- CreateEnum
CREATE TYPE "public"."EventMemberStatus" AS ENUM ('listed', 'invited', 'accepted', 'declined', 'messaged');

-- CreateEnum
CREATE TYPE "public"."TimeslotStatus" AS ENUM ('invites', 'suggested', 'accepted', 'declined');

-- CreateTable
CREATE TABLE "public"."User" (
    "user_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone_number" TEXT,
    "timezone" TEXT NOT NULL,
    "created_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "public"."Activity" (
    "activity_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("activity_id")
);

-- CreateTable
CREATE TABLE "public"."Member" (
    "member_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone_number" TEXT,
    "email" TEXT,
    "location" TEXT,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("member_id")
);

-- CreateTable
CREATE TABLE "public"."Event" (
    "event_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_by_user_id" UUID NOT NULL,
    "activity_id" UUID,
    "location" TEXT,
    "max_participants" INTEGER,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "public"."EventMember" (
    "event_member_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "status" "public"."EventMemberStatus" NOT NULL DEFAULT 'listed',

    CONSTRAINT "EventMember_pkey" PRIMARY KEY ("event_member_id")
);

-- CreateTable
CREATE TABLE "public"."Timeslot" (
    "timeslot_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "start_time" TIMESTAMPTZ(6) NOT NULL,
    "end_time" TIMESTAMPTZ(6) NOT NULL,
    "status" "public"."TimeslotStatus" NOT NULL DEFAULT 'suggested',

    CONSTRAINT "Timeslot_pkey" PRIMARY KEY ("timeslot_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_number_key" ON "public"."User"("phone_number");

-- CreateIndex
CREATE INDEX "Activity_user_id_idx" ON "public"."Activity"("user_id");

-- CreateIndex
CREATE INDEX "Member_user_id_idx" ON "public"."Member"("user_id");

-- CreateIndex
CREATE INDEX "Event_created_by_user_id_idx" ON "public"."Event"("created_by_user_id");

-- CreateIndex
CREATE INDEX "Event_activity_id_idx" ON "public"."Event"("activity_id");

-- CreateIndex
CREATE INDEX "EventMember_event_id_idx" ON "public"."EventMember"("event_id");

-- CreateIndex
CREATE INDEX "EventMember_member_id_idx" ON "public"."EventMember"("member_id");

-- CreateIndex
CREATE INDEX "Timeslot_event_id_idx" ON "public"."Timeslot"("event_id");

-- AddForeignKey
ALTER TABLE "public"."Activity" ADD CONSTRAINT "Activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Member" ADD CONSTRAINT "Member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Event" ADD CONSTRAINT "Event_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."User"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Event" ADD CONSTRAINT "Event_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "public"."Activity"("activity_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EventMember" ADD CONSTRAINT "EventMember_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."Event"("event_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EventMember" ADD CONSTRAINT "EventMember_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."Member"("member_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Timeslot" ADD CONSTRAINT "Timeslot_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."Event"("event_id") ON DELETE CASCADE ON UPDATE CASCADE;
