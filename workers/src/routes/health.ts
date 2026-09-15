import { Hono } from "hono";
import { withClient } from "../db";
import type { AppEnv } from "../env";

export const healthRoutes = new Hono<AppEnv>();

healthRoutes.get("/health", async (c) => {
  const pg = await withClient(c.env, (client) => client.query("SELECT 1")).then(
    () => true,
    () => false
  );
  return c.json({ status: "ok", pg }, pg ? 200 : 503);
});
