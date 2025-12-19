import "dotenv/config";

import express from "express";
import { PrismaClient } from "@prisma/client";
import logger, { asyncLocalStorage } from "./utils/logger";
import { v4 as uuidv4 } from "uuid";
import path from "path";

import userRouter from "./routes/user";
import activityRouter from "./routes/activity";
import memberRouter from "./routes/member";
import eventRouter from "./routes/event";
import eventMemberRouter from "./routes/eventMember";
import timeSlotRouter from "./routes/timeSlot";
import conversationRouter from "./routes/conversation";

const app = express();
const prisma = new PrismaClient();

// Middleware to assign a unique request ID and run the request in AsyncLocalStorage context
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  const requestId = uuidv4();
  asyncLocalStorage.run(new Map([["requestId", requestId]]), () => {
    next();
  });
});

// Twilio webhooks POST as application/x-www-form-urlencoded by default
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Serve static assets (e.g. vCard contact files) from /public
// Example: GET /public/Buckfifty%20AI%20Assistant.vcf
app.use("/public", express.static(path.join(process.cwd(), "public")));

app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.info(`Incoming request: ${req.method} ${req.url} - Body: ${JSON.stringify(req.body)}`);

  // Hook into res.send to log response body
  const originalSend = res.send.bind(res);
  res.send = (body?: any): express.Response => {
    logger.info(`Response for ${req.method} ${req.url} - Status: ${res.statusCode} - Body: ${body}`);
    return originalSend(body);
  };

  next();
});

app.use("/users", userRouter);
app.use("/activities", activityRouter);
app.use("/members", memberRouter);
app.use("/events", eventRouter);
app.use("/eventMembers", eventMemberRouter);
app.use("/timeSlots", timeSlotRouter);
app.use("/conversations", conversationRouter);

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

const port = process.env.DEV === '1' ? 3000 : 80;
app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});
