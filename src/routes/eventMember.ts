import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

// Create EventMember
router.post("/", async (req: Request, res: Response) => {
  try {
    const eventMember = await prisma.eventMember.create({ data: req.body });
    res.status(201).json(eventMember);
  } catch (error) {
    res.status(500).json({ error: "Failed to create event member" });
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
    const eventMember = await prisma.eventMember.update({
      where: { event_member_id: req.params.id },
      data: req.body,
    });
    res.json(eventMember);
  } catch (error) {
    res.status(500).json({ error: "Failed to update event member" });
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
