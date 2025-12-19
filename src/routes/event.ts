import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

// Create Event
router.post("/", async (req: Request, res: Response) => {
  try {
    const event = await prisma.event.create({ data: req.body });
    res.status(201).json(event);
  } catch (error: any) {
    console.error("Error creating event:", error);
    res
      .status(500)
      .json({ error: "Failed to create event", details: error.message || error.toString() });
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

router.get("/active-events-by-user/:userId", async (req: Request, res: Response) => {
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
});

export default router;
