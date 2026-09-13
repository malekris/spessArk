import express from "express";
import {
  readSiteVisitStats,
  recordSiteVisit,
} from "../services/siteVisitService.js";

export default function createPublicSiteVisitRoutes(pool) {
  const router = express.Router();

  router.get("/visits", async (_req, res) => {
    try {
      const stats = await readSiteVisitStats(pool);
      res.set("Cache-Control", "no-store");
      return res.json(stats);
    } catch (error) {
      console.error("Public visitor stats read failed:", error);
      return res.status(500).json({ message: "Visitor statistics are temporarily unavailable." });
    }
  });

  router.post("/visits", async (req, res) => {
    try {
      const stats = await recordSiteVisit(pool, {
        surface: req.body?.surface,
        visitorId: req.body?.visitorId,
      });
      res.set("Cache-Control", "no-store");
      return res.json(stats);
    } catch (error) {
      if (error?.code === "INVALID_VISITOR_RECORD") {
        return res.status(400).json({ message: "A valid daily visitor record is required." });
      }
      console.error("Public visitor count failed:", error);
      return res.status(500).json({ message: "This visit could not be counted." });
    }
  });

  return router;
}
