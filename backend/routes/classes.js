import express from "express";

const router = express.Router();

/**
 * MASTER CLASS LIST
 * Always available, even with empty DB
 */
const MASTER_CLASSES = [
  "S1",
  "S2",
  "S3",
  "S4",
  "S5",
  "S6",
];

router.get("/", (req, res) => {
  res.json(
    MASTER_CLASSES.map((c) => ({
      id: c,
      name: c,
    }))
  );
});

export default router;
