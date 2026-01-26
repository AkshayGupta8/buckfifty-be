import { buildMemberInviteSms } from "../../src/conversationTwilio/domain/inviteFormatting";

// Lightweight manual script to eyeball SMS variation.
// Run:
//   npx ts-node test-scripts/manual/print_invite_sms_variants.ts

const sms = () =>
  buildMemberInviteSms({
    member: {
      member_id: "m1",
      user_id: "u1",
      first_name: "Sam",
      last_name: "Smith",
      phone_number: "+15555550123",
      created_at: new Date(),
      updated_at: new Date(),
    } as any,
    event: {
      event_id: "e1",
      created_by_user_id: "u1",
      activity_id: null,
      location: "Cheesman Park",
      max_participants: 6,
      invite_message: "Bring a light jacket.",
      invite_policy: "any",
      created_at: new Date(),
      updated_at: new Date(),
    } as any,
    timeSlot: {
      time_slot_id: "ts1",
      event_id: "e1",
      start_time: new Date(Date.now() + 1000 * 60 * 60 * 24),
      end_time: new Date(Date.now() + 1000 * 60 * 60 * 25),
      created_at: new Date(),
      updated_at: new Date(),
    } as any,
    activityName: "play hoops",
    creatorFirstName: "Akshay",
    timeZone: "America/Denver",
  });

for (let i = 0; i < 15; i++) {
  console.log(`\n--- Sample ${i + 1} ---`);
  console.log(sms());
}
