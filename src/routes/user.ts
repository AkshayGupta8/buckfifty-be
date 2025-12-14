import { Router, Request, Response } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import { sendMms, sendSms } from "../utils/twilioClient";

const prisma = new PrismaClient();
const router = Router();

// Create User
router.post("/", async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.create({ data: req.body });
    res.status(201).json(user);
  } catch (error: any) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      Array.isArray(error.meta?.target) &&
      error.meta.target.includes("phone_number")
    ) {
      return res.status(400).json({ error: "Phone number is already registered" });
    }
    res.status(500).json({ error: "Failed to create user" });
  }
});

// List all Users
router.get("/", async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// Get User by ID
router.get("/id/:id", async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { user_id: req.params.id },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// Get User by phone number
router.get("/phone/:phoneNumber", async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { phone_number: req.params.phoneNumber },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: `Failed to fetch user - ${error}` });
  }
});

// Update User by ID
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.update({
      where: { user_id: req.params.id },
      data: req.body,
    });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: "Failed to update user" });
  }
});

// Delete User by ID (cascade)
router.delete("/:id", async (req: Request, res: Response) => {
  const userId = req.params.id;

  try {
    await prisma.$transaction(async (tx) => {
      // Must delete events first because Event.createdBy -> User is ON DELETE RESTRICT
      await tx.event.deleteMany({
        where: { created_by_user_id: userId },
      });

      // DB-level cascades will remove activities, members, phone auth codes, etc.
      await tx.user.delete({ where: { user_id: userId } });
    });

    res.status(204).send();
  } catch (error: any) {
    // Record not found
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return res.status(404).json({ error: "User not found" });
    }

    console.error("Failed to delete user:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

// POST /users/:userId/send-code
router.post("/:userId/send-code", async (req: Request, res: Response) => {
  const { userId } = req.params;

  try {
    // Fetch user with phone number
    const user = await prisma.user.findUnique({
      where: { user_id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!user.phone_number) {
      return res.status(400).json({ error: "User has no phone number" });
    }

    // Generate random 4-digit code
    const code = Math.floor(1000 + Math.random() * 9000).toString();

    // Store code in PhoneAuthCode table
    await prisma.phoneAuthCode.create({
      data: {
        user_id: userId,
        code,
      },
    });

    // Send SMS via Twilio
    const messageBody = `Your authentication code is: ${code}`;
    await sendSms(user.phone_number, messageBody);

    res.json({ message: "Authentication code sent" });
  } catch (error) {
    console.error("Error in send-code endpoint:", error);
    res.status(500).json({ error: "Failed to send authentication code" });
  }
});

// POST /users/:userId/verify-code
router.post("/:userId/verify-code", async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { code } = req.body;

  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "Code is required and must be a string" });
  }

  try {
    // Find latest code for user within last 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const authCode = await prisma.phoneAuthCode.findFirst({
      where: {
        user_id: userId,
        code,
        created_at: {
          gte: tenMinutesAgo,
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    const isAuthenticated = !!authCode;

    res.json({ authenticated: isAuthenticated });
  } catch (error) {
    console.error("Error in verify-code endpoint:", error);
    res.status(500).json({ error: "Failed to verify authentication code" });
  }
});

// POST /users/:userId/send-contact-card
router.post("/:userId/send-contact-card", async (req: Request, res: Response) => {
  const { userId } = req.params;

  try {
    const user = await prisma.user.findUnique({
      where: { user_id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!user.phone_number) {
      return res.status(400).json({ error: "User has no phone number" });
    }

    const publicBaseUrl = process.env.PUBLIC_BASE_URL;
    if (!publicBaseUrl) {
      return res.status(500).json({ error: "PUBLIC_BASE_URL is not set" });
    }

    // Existing vCard file hosted via express.static at /public
    const vcardPath = "/public/Buckfifty%20AI%20Assistant.vcf";
    const mediaUrl = new URL(vcardPath, publicBaseUrl).toString();

    const messageBody = "Save Buckfifty to your contacts";
    const messageSid = await sendMms(user.phone_number, messageBody, mediaUrl);

    res.json({ message: "Contact Card sent", messageSid, mediaUrl });
  } catch (error) {
    console.error("Error in send-contact-card endpoint:", error);
    res.status(500).json({ error: "Failed to send contact card" });
  }
});

export default router;
