import express from "express";
import { PrismaClient } from "@prisma/client";

import userRouter from "./routes/user";
import activityRouter from "./routes/activity";
import memberRouter from "./routes/member";
import eventRouter from "./routes/event";
import eventMemberRouter from "./routes/eventMember";
import timeSlotRouter from "./routes/timeSlot";

const app = express();
const prisma = new PrismaClient();

app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(express.json());

app.use("/users", userRouter);
app.use("/activities", activityRouter);
app.use("/members", memberRouter);
app.use("/events", eventRouter);
app.use("/eventMembers", eventMemberRouter);
app.use("/timeSlots", timeSlotRouter);

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

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
