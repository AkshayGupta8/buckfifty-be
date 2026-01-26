import "dotenv/config";

import express from "express";
import { PrismaClient } from "@prisma/client";
import logger, { asyncLocalStorage, setLogContext } from "./utils/logger";
import { v4 as uuidv4 } from "uuid";
import path from "path";

import userRouter from "./routes/user";
import activityRouter from "./routes/activity";
import memberRouter from "./routes/member";
import eventRouter from "./routes/event";
import eventMemberRouter from "./routes/eventMember";
import timeSlotRouter from "./routes/timeSlot";
import conversationRouter from "./routes/conversation";
import twilioRouter from "./routes/twilio";
import { startInviteTimeoutPoller } from "./conversationTwilio/pollers/inviteTimeoutPoller";

const app = express();
const prisma = new PrismaClient();

// Middleware to assign a unique request ID and run the request in AsyncLocalStorage context
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  const requestId = (req.header("x-request-id") || req.header("x-amzn-trace-id") || "")
    .toString()
    .trim();

  const finalRequestId = requestId || uuidv4();
  const start = Date.now();

  asyncLocalStorage.run(
    {
      requestId: finalRequestId,
      method: req.method,
      path: req.url,
    },
    () => {
      // Add/override any context later in the request.
      setLogContext({ method: req.method, path: req.url });

      logger.info("http.request", {
        method: req.method,
        path: req.url,
        // Keep body logging opt-in; Twilio payloads can be helpful.
        ...(process.env.LOG_HTTP_BODY === "1" ? { body: req.body } : {}),
      });

      res.on("finish", () => {
        logger.info("http.response", {
          method: req.method,
          path: req.url,
          statusCode: res.statusCode,
          durationMs: Date.now() - start,
        });
      });

      next();
    }
  );
});

// Twilio webhooks POST as application/x-www-form-urlencoded by default
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Serve static assets (e.g. vCard contact files) from /public
// Example: GET /public/Buckfifty%20AI%20Assistant.vcf
app.use("/public", express.static(path.join(process.cwd(), "public")));

// NOTE: request/response logging is handled in the requestId middleware above.

app.use("/users", userRouter);
app.use("/activities", activityRouter);
app.use("/members", memberRouter);
app.use("/events", eventRouter);
app.use("/eventMembers", eventMemberRouter);
app.use("/timeSlots", timeSlotRouter);
app.use("/conversations", conversationRouter);
app.use("/twilio", twilioRouter);

app.get("/", (req: express.Request, res: express.Response) => {
  res.status(200).sendFile(path.join(process.cwd(), "public", "index.html"));
});

app.get("/echo", (req: express.Request, res: express.Response) => {
  const message = req.query.message || "Hello from echo endpoint!";
  res.json({ echo: message });
});

app.get("/tables", async (req: express.Request, res: express.Response) => {
  try {
    const tables = await prisma.$queryRaw<
      { tablename: string }[]
    >`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'`;
    res.json(tables.map(t => t.tablename));
  } catch (error) {
    res.status(500).json({ error: `Failed to fetch tables - ${error}` });
  }
});

const port = Number(process.env.PORT ?? (process.env.DEV === '1' ? 3000 : 80));
app.listen(port, () => {
  logger.info(`Server running on port ${port}`);

  // Background poller: marks expired invites as timed out and backfills from listed pool.
  // Kill switch: set INVITE_TIMEOUT_POLLER=0 to disable.
  if (process.env.INVITE_TIMEOUT_POLLER !== "0") {
    const intervalMsRaw = process.env.INVITE_TIMEOUT_POLLER_INTERVAL_MS;
    const intervalMsParsed = intervalMsRaw ? Number(intervalMsRaw) : NaN;
    const intervalMs = Number.isFinite(intervalMsParsed) ? intervalMsParsed : 60_000;

    startInviteTimeoutPoller({ intervalMs });
  }
});
