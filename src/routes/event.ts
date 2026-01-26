import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import logger from "../utils/logger";
import {
  ACTIVE_CAPACITY_STATUSES,
  validateMaxParticipantsValue,
} from "../domain/eventCapacity";

const prisma = new PrismaClient();
const router = Router();

const CAPACITY_ERR_PREFIX = "CAPACITY:";

function isCapacityError(err: any): boolean {
  return typeof err?.message === "string" && err.message.startsWith(CAPACITY_ERR_PREFIX);
}

function capacityErrorMessage(err: any): string {
  return String(err?.message ?? "").replace(CAPACITY_ERR_PREFIX, "").trim();
}

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
            { priority_rank: { sort: "asc", nulls: "last" } },
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
    // Validate max_participants if present.
    const maxCheck = validateMaxParticipantsValue((req.body ?? {}).max_participants);
    if (!maxCheck.ok) {
      return res.status(400).json({ error: maxCheck.reason });
    }

    // Use a transaction so if nested EventMember writes exceed capacity, we rollback.
    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          ...(req.body ?? {}),
          max_participants: maxCheck.value,
        },
      });

      const max = created.max_participants;
      if (typeof max === "number") {
        const activeCount = await tx.eventMember.count({
          where: {
            event_id: created.event_id,
            // accepted-only counts; invited/messaged/listed/declined do not.
            status: { in: [...ACTIVE_CAPACITY_STATUSES] },
          },
        });

        if (activeCount > max) {
          throw new Error(
            `${CAPACITY_ERR_PREFIX} Event has ${activeCount} active homies but max_participants is ${max}.`
          );
        }
      }

      return created;
    });

    return res.status(201).json(event);
  } catch (error: any) {
    if (isCapacityError(error)) {
      return res.status(400).json({ error: capacityErrorMessage(error) });
    }
    logger.error("event.create.failed", { error });
    return res
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
    const data: any = { ...(req.body ?? {}) };

    // Only validate max_participants if the client is attempting to set it.
    if (Object.prototype.hasOwnProperty.call(data, "max_participants")) {
      const maxCheck = validateMaxParticipantsValue(data.max_participants);
      if (!maxCheck.ok) {
        return res.status(400).json({ error: maxCheck.reason });
      }
      data.max_participants = maxCheck.value;
    }

    const event = await prisma.$transaction(async (tx) => {
      const updated = await tx.event.update({
        where: { event_id: req.params.id },
        data,
      });

      const max = updated.max_participants;
      if (typeof max === "number") {
        const activeCount = await tx.eventMember.count({
          where: {
            event_id: updated.event_id,
            status: { in: [...ACTIVE_CAPACITY_STATUSES] },
          },
        });

        if (activeCount > max) {
          throw new Error(
            `${CAPACITY_ERR_PREFIX} Event has ${activeCount} active homies but max_participants is ${max}.`
          );
        }
      }

      return updated;
    });

    return res.json(event);
  } catch (error) {
    if (isCapacityError(error)) {
      return res.status(400).json({ error: capacityErrorMessage(error) });
    }
    return res.status(500).json({ error: "Failed to update event" });
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
