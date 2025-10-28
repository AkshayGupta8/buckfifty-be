-- CreateTable
CREATE TABLE "public"."PhoneAuthCode" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhoneAuthCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhoneAuthCode_user_id_idx" ON "public"."PhoneAuthCode"("user_id");

-- CreateIndex
CREATE INDEX "PhoneAuthCode_created_at_idx" ON "public"."PhoneAuthCode"("created_at");

-- AddForeignKey
ALTER TABLE "public"."PhoneAuthCode" ADD CONSTRAINT "PhoneAuthCode_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
