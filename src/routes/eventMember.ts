import { Router, Request, Response } from "express";
import { PrismaClient, type EventMemberStatus } from "@prisma/client";
import {
  ACTIVE_CAPACITY_STATUSES,
  normalizeMaxParticipants,
  statusCountsTowardCapacity,
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

const ALL_EVENT_MEMBER_STATUSES: readonly EventMemberStatus[] = [
  "listed",
  "invited",
  "accepted",
  "declined",
  "messaged",
];

function parseEventMemberStatus(input: unknown): EventMemberStatus | null {
  if (typeof input !== "string") return null;
  return (ALL_EVENT_MEMBER_STATUSES as readonly string[]).includes(input)
    ? (input as EventMemberStatus)
    : null;
}

// Create EventMember
router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const eventId = body.event_id;
    const memberId = body.member_id;

    if (!eventId || typeof eventId !== "string") {
      return res.status(400).json({ error: "event_id is required" });
    }
    if (!memberId || typeof memberId !== "string") {
      return res.status(400).json({ error: "member_id is required" });
    }

    // Prisma default is `listed`.
    const desiredStatus: EventMemberStatus =
      parseEventMemberStatus(body.status) ?? "listed";

    const eventMember = await prisma.$transaction(async (tx) => {
      // Only enforce capacity for statuses that count.
      if (statusCountsTowardCapacity(desiredStatus)) {
        const event = await tx.event.findUnique({
          where: { event_id: eventId },
          select: { max_participants: true },
        });
        if (!event) {
          throw new Error(`${CAPACITY_ERR_PREFIX} Event not found`);
        }

        const max = normalizeMaxParticipants(event.max_participants);
        if (typeof max === "number") {
          const activeCount = await tx.eventMember.count({
            where: {
              event_id: eventId,
              status: { in: [...ACTIVE_CAPACITY_STATUSES] },
            },
          });

          // If we're creating an EventMember with status=accepted, it contributes 1.
          if (activeCount + 1 > max) {
            throw new Error(
              `${CAPACITY_ERR_PREFIX} Event is at capacity (${max}) — cannot add another active homie.`
            );
          }
        }
      }

      return tx.eventMember.create({
        data: {
          ...body,
          status: desiredStatus,
        },
      });
    });

    return res.status(201).json(eventMember);
  } catch (error) {
    if (isCapacityError(error)) {
      return res.status(400).json({ error: capacityErrorMessage(error) });
    }
    return res.status(500).json({ error: "Failed to create event member" });
  }
});

// List all EventMembers
router.get("/", async (req: Request, res: Response) => {
  try {
    const eventMembers = await prisma.eventMember.findMany();
    res.json(eventMembers);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch event members" });
  }
});

// Get EventMember by ID
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const eventMember = await prisma.eventMember.findUnique({
      where: { event_member_id: req.params.id },
    });
    if (!eventMember) return res.status(404).json({ error: "Event member not found" });
    res.json(eventMember);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch event member" });
  }
});

// Update EventMember by ID
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};

    // Avoid complex/unsafe semantics.
    if (Object.prototype.hasOwnProperty.call(body, "event_id")) {
      return res.status(400).json({ error: "event_id cannot be changed" });
    }
    if (Object.prototype.hasOwnProperty.call(body, "member_id")) {
      return res.status(400).json({ error: "member_id cannot be changed" });
    }

    // If status is being updated, validate it.
    let desiredStatus: EventMemberStatus | undefined;
    if (Object.prototype.hasOwnProperty.call(body, "status")) {
      const parsed = parseEventMemberStatus(body.status);
      if (!parsed) {
        return res.status(400).json({ error: "Invalid status" });
      }
      desiredStatus = parsed;
    }

    const eventMember = await prisma.$transaction(async (tx) => {
      const existing = await tx.eventMember.findUnique({
        where: { event_member_id: req.params.id },
        select: { event_id: true, status: true },
      });
      if (!existing) {
        throw new Error(`${CAPACITY_ERR_PREFIX} Event member not found`);
      }

      const nextStatus = desiredStatus ?? existing.status;

      // Only enforce if the status transition affects capacity.
      const prevCounts = statusCountsTowardCapacity(existing.status);
      const nextCounts = statusCountsTowardCapacity(nextStatus);

      if (prevCounts !== nextCounts) {
        const event = await tx.event.findUnique({
          where: { event_id: existing.event_id },
          select: { max_participants: true },
        });
        if (!event) {
          throw new Error(`${CAPACITY_ERR_PREFIX} Event not found`);
        }

        const max = normalizeMaxParticipants(event.max_participants);
        if (typeof max === "number") {
          const activeCount = await tx.eventMember.count({
            where: {
              event_id: existing.event_id,
              status: { in: [...ACTIVE_CAPACITY_STATUSES] },
            },
          });

          const attemptedActiveCount =
            activeCount - (prevCounts ? 1 : 0) + (nextCounts ? 1 : 0);

          if (attemptedActiveCount > max) {
            throw new Error(
              `${CAPACITY_ERR_PREFIX} Event is at capacity (${max}) — cannot set this homie to an active status.`
            );
          }
        }
      }

      return tx.eventMember.update({
        where: { event_member_id: req.params.id },
        data: {
          ...body,
          ...(desiredStatus ? { status: desiredStatus } : {}),
        },
      });
    });

    return res.json(eventMember);
  } catch (error) {
    if (isCapacityError(error)) {
      return res.status(400).json({ error: capacityErrorMessage(error) });
    }
    return res.status(500).json({ error: "Failed to update event member" });
  }
});

// Delete EventMember by ID
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await prisma.eventMember.delete({ where: { event_member_id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete event member" });
  }
});

// List EventMembers by event_id (foreign key)
router.get("/by-event/:eventId", async (req: Request, res: Response) => {
  try {
    const eventMembers = await prisma.eventMember.findMany({
      where: { event_id: req.params.eventId },
      include: {
        event: true,
        member: true,
      },
    });
    res.json(eventMembers);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch event members by event" });
  }
});

// List EventMembers by member_id (foreign key)
router.get("/by-member/:memberId", async (req: Request, res: Response) => {
  try {
    const eventMembers = await prisma.eventMember.findMany({
      where: { member_id: req.params.memberId },
      include: {
        event: true,
        member: true,
      },
    });
    res.json(eventMembers);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch event members by member" });
  }
});

export default router;
