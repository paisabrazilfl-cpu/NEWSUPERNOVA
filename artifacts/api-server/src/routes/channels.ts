import { Router } from "express";
import { db } from "@workspace/db";
import { channelsTable, messagesTable, insertChannelSchema, insertMessageSchema } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const channels = await db.select().from(channelsTable).orderBy(channelsTable.id);
    res.json(channels.map(c => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
      lastActivity: c.lastActivity?.toISOString() ?? null,
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to list channels");
    res.status(500).json({ error: "Failed to list channels" });
  }
});

router.post("/", async (req, res) => {
  const parse = insertChannelSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid channel data" });
  try {
    const [channel] = await db.insert(channelsTable).values(parse.data).returning();
    return res.status(201).json({
      ...channel,
      createdAt: channel.createdAt.toISOString(),
      lastActivity: channel.lastActivity?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create channel");
    return res.status(500).json({ error: "Failed to create channel" });
  }
});

router.get("/:channelId/messages", async (req, res) => {
  const channelId = parseInt(req.params.channelId);
  if (isNaN(channelId)) return res.status(400).json({ error: "Invalid channel ID" });
  try {
    const messages = await db.select().from(messagesTable)
      .where(eq(messagesTable.channelId, channelId))
      .orderBy(messagesTable.timestamp)
      .limit(100);
    return res.json(messages.map(m => ({
      ...m,
      timestamp: m.timestamp.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to list messages");
    return res.status(500).json({ error: "Failed to list messages" });
  }
});

router.post("/:channelId/messages", async (req, res) => {
  const channelId = parseInt(req.params.channelId);
  if (isNaN(channelId)) return res.status(400).json({ error: "Invalid channel ID" });
  const parse = insertMessageSchema.safeParse({ ...req.body, channelId });
  if (!parse.success) return res.status(400).json({ error: "Invalid message data" });
  try {
    const [message] = await db.insert(messagesTable).values(parse.data).returning();
    await db.update(channelsTable)
      .set({ lastActivity: new Date() })
      .where(eq(channelsTable.id, channelId));
    return res.status(201).json({ ...message, timestamp: message.timestamp.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Failed to send message");
    return res.status(500).json({ error: "Failed to send message" });
  }
});

export default router;
