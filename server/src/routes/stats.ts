import { Router } from "express";
import { getStats } from "../db/links.js";

export const statsRouter: Router = Router();

statsRouter.get("/stats/:code", async (req, res, next) => {
  try {
    const stats = await getStats(req.params.code);
    if (!stats) return res.status(404).json({ error: "no link found for that code" });
    return res.json(stats);
  } catch (err) {
    next(err);
  }
});
