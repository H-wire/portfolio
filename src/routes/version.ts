import { Router } from "express";
import { config } from "../config";
import { sendData } from "../http";

const router = Router();

router.get("/version", (_req, res) => {
  return sendData(res, {
    version: config.appVersion,
  });
});

export { router as versionRouter };
