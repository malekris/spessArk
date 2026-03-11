import express from "express";
import authAdmin from "../middleware/authAdmin.js";
import {
  executePromotionsController,
  getGraduatedStudentsController,
  getPromotionHistoryController,
  previewPromotionsController,
} from "../controllers/adminPromotionController.js";

const router = express.Router();

// Preview eligible learners and target class/stream.
router.get("/promotions/preview", authAdmin, previewPromotionsController);

// Execute promotions in a single transaction.
router.post("/promotions/execute", authAdmin, executePromotionsController);

// Search and paginate graduated learners.
router.get("/graduated", authAdmin, getGraduatedStudentsController);

// Paginated promotion history.
router.get("/promotions/history", authAdmin, getPromotionHistoryController);

export default router;

