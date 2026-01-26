# Member invite coordinator flow (manual test)

This is a manual checklist to validate the **member coordinator** end-to-end.

## Prereqs
- Local server running: `npm run dev`
- Twilio webhook is pointed at your local dev (or use Twilio Console test message)
- You have:
  - a User with a phone number
  - at least 2 Members with phone numbers

## Create an event that invites a member
1) Create an event via the normal scheduling flow (text the user phone), confirm it.
2) Ensure at least one `EventMember` has `status=invited` and at least one has `status=listed`.

## Test: accept
1) From the invited homie phone, reply: `yes I’m in`
2) Expect:
   - `EventMember.status` becomes `accepted` (if capacity allows)
   - Homie receives: `Awesome — hope you have fun!`
   - Creator receives: `<Homie Name> accepted. <summary>`

## Test: decline triggers backfill
1) From the invited homie phone, reply: `can’t make it`
2) Expect:
   - `EventMember.status` becomes `declined`
   - Homie receives: `All good — sorry you can’t make it. Maybe next time.`
   - Creator receives: `<Homie Name> declined. <summary>`
   - Next listed homie is promoted to `invited` + receives an invite SMS.

## Test: yes-but-full
1) Create an event with capacity N and already fill it with N accepted/invited homies.
2) Have another invited homie reply: `yes`
3) Expect:
   - Their `EventMember.status` becomes `declined`
   - Homie receives: `Sorry — it’s full now. Maybe next time.`
   - Backfill runs (same as decline).

## Test: questions after accept/decline (routing)
1) After accept, from the same homie phone ask: `where is it?`
2) After decline, ask: `what time was it again?`
3) Expect:
   - Message is still routed as `senderType=member` (because statuses invited/accepted/declined are “active” until event starts)
   - Coordinator responds with an LLM answer that uses event details.
