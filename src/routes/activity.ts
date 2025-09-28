import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

// Create Activity
router.post("/", async (req: Request, res: Response) => {
  try {
    const activity = await prisma.activity.create({ data: req.body });
    res.status(201).json(activity);
  } catch (error) {
    res.status(500).json({ error: "Failed to create activity" });
  }
});

// List all Activities
router.get("/", async (req: Request, res: Response) => {
  try {
    const activities = await prisma.activity.findMany();
    res.json(activities);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch activities" });
  }
});

// Get Activity by ID
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const activity = await prisma.activity.findUnique({
      where: { activity_id: req.params.id },
    });
    if (!activity) return res.status(404).json({ error: "Activity not found" });
    res.json(activity);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch activity" });
  }
});

// Update Activity by ID
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const activity = await prisma.activity.update({
      where: { activity_id: req.params.id },
      data: req.body,
    });
    res.json(activity);
  } catch (error) {
    res.status(500).json({ error: "Failed to update activity" });
  }
});

// Delete Activity by ID
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await prisma.activity.delete({ where: { activity_id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete activity" });
  }
});

// List Activities by user_id (foreign key)
router.get("/by-user/:userId", async (req: Request, res: Response) => {
  try {
    const activities = await prisma.activity.findMany({
      where: { user_id: req.params.userId },
    });
    res.json(activities);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch activities by user" });
  }
});

export default router;
