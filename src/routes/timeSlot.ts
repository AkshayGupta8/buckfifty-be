import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

// Create TimeSlot
router.post("/", async (req: Request, res: Response) => {
  try {
    const timeSlot = await prisma.timeSlot.create({ data: req.body });
    res.status(201).json(timeSlot);
  } catch (error) {
    res.status(500).json({ error: "Failed to create timeSlot" });
  }
});

// List all TimeSlots
router.get("/", async (req: Request, res: Response) => {
  try {
    const timeSlots = await prisma.timeSlot.findMany();
    res.json(timeSlots);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch timeSlots" });
  }
});

// Get TimeSlot by ID
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const timeSlot = await prisma.timeSlot.findUnique({
      where: { time_slot_id: req.params.id },
    });
    if (!timeSlot) return res.status(404).json({ error: "TimeSlot not found" });
    res.json(timeSlot);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch timeSlot" });
  }
});

// Update TimeSlot by ID
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const timeSlot = await prisma.timeSlot.update({
      where: { time_slot_id: req.params.id },
      data: req.body,
    });
    res.json(timeSlot);
  } catch (error) {
    res.status(500).json({ error: "Failed to update timeSlot" });
  }
});

// Delete TimeSlot by ID
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await prisma.timeSlot.delete({ where: { time_slot_id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete timeSlot" });
  }
});

// List TimeSlots by event_id (foreign key)
router.get("/by-event/:eventId", async (req: Request, res: Response) => {
  try {
    const timeSlots = await prisma.timeSlot.findMany({
      where: { event_id: req.params.eventId },
    });
    res.json(timeSlots);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch timeSlots by event" });
  }
});

export default router;
