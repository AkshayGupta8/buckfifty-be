import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import logger from "../utils/logger";

const prisma = new PrismaClient();
const router = Router();

// Get full Event details by ID (activity, members, timeslots, etc.)
// NOTE: Keep this route BEFORE `/:id` to avoid shadowing.
router.get("/:id/details", async (req: Request, res: Response) => {
  try {
    const event = await prisma.event.findUnique({
      where: { event_id: req.params.id },
      include: {
        activity: true,
        timeSlots: {
          orderBy: { start_time: "asc" },
        },
        eventMembers: {
          include: {
            member: true,
          },
          orderBy: [
            { priority_rank: "asc" },
            // secondary stable ordering
            { member: { last_name: "asc" } },
            { member: { first_name: "asc" } },
            { event_member_id: "asc" },
          ],
        },
      },
    });

    if (!event) return res.status(404).json({ error: "Event not found" });

    const earliestTimeSlot = event.timeSlots?.[0] ?? null;

    // Return a single object containing:
    // - all Event scalar fields
    // - included relations (activity, timeSlots, eventMembers)
    // - computed start/end derived from earliest timeslot
    res.json({
      ...event,
      start_time: earliestTimeSlot?.start_time ?? null,
      end_time: earliestTimeSlot?.end_time ?? null,
    });
  } catch (error: any) {
    logger.error("event.details.failed", { error });
    res.status(500).json({
      error: "Failed to fetch event details",
      details: error.message || error.toString(),
    });
  }
});

// Create Event
router.post("/", async (req: Request, res: Response) => {
  try {
    const event = await prisma.event.create({ data: req.body });
    res.status(201).json(event);
  } catch (error: any) {
    logger.error("event.create.failed", { error });
    res
      .status(500)
      .json({
        error: "Failed to create event",
        details: error.message || error.toString(),
      });
  }
});

// List all Events
router.get("/", async (req: Request, res: Response) => {
  try {
    const events = await prisma.event.findMany();
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

// Get Event by ID
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const event = await prisma.event.findUnique({
      where: { event_id: req.params.id },
    });
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.json(event);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch event" });
  }
});

// Update Event by ID
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const event = await prisma.event.update({
      where: { event_id: req.params.id },
      data: req.body,
    });
    res.json(event);
  } catch (error) {
    res.status(500).json({ error: "Failed to update event" });
  }
});

// Delete Event by ID
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await prisma.event.delete({ where: { event_id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete event" });
  }
});

// List Events by created_by_user_id (foreign key)
router.get("/by-user/:userId", async (req: Request, res: Response) => {
  try {
    const events = await prisma.event.findMany({
      where: { created_by_user_id: req.params.userId },
    });
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch events by user" });
  }
});

// List Events by activity_id (foreign key)
router.get("/by-activity/:activityId", async (req: Request, res: Response) => {
  try {
    const events = await prisma.event.findMany({
      where: { activity_id: req.params.activityId },
    });
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch events by activity" });
  }
});

router.get(
  "/active-events-by-user/:userId",
  async (req: Request, res: Response) => {
    try {
      const userId = req.params.userId;

      // Get current UTC time
      const now = new Date();

      // Find events created by user with at least one timeSlot where end_time > now
      const events = await prisma.event.findMany({
        where: {
          created_by_user_id: userId,
          timeSlots: {
            some: {
              end_time: {
                gt: now,
              },
            },
          },
        },
        include: {
          timeSlots: true,
        },
      });

      res.json(events);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch current events by user" });
    }
  }
);

export default router;
