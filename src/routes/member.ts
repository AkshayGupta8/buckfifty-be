import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

// Create Member
router.post("/", async (req: Request, res: Response) => {
  try {
    const member = await prisma.member.create({ data: req.body });
    res.status(201).json(member);
  } catch (error) {
    res.status(500).json({ error: "Failed to create member" });
  }
});

// List all Members
router.get("/", async (req: Request, res: Response) => {
  try {
    const members = await prisma.member.findMany();
    res.json(members);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch members" });
  }
});

// Get Member by ID
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const member = await prisma.member.findUnique({
      where: { member_id: req.params.id },
    });
    if (!member) return res.status(404).json({ error: "Member not found" });
    res.json(member);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch member" });
  }
});

// Update Member by ID
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const member = await prisma.member.update({
      where: { member_id: req.params.id },
      data: req.body,
    });
    res.json(member);
  } catch (error) {
    res.status(500).json({ error: "Failed to update member" });
  }
});

// Delete Member by ID
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await prisma.member.delete({ where: { member_id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete member" });
  }
});

// List Members by user_id (foreign key)
router.get("/by-user/:userId", async (req: Request, res: Response) => {
  try {
    const members = await prisma.member.findMany({
      where: { user_id: req.params.userId },
    });
    res.json(members);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch members by user" });
  }
});

export default router;
