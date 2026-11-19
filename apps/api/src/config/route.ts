import { type ConfigResponse } from "@waypoint/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { ConfigError, loadConfig } from "./load.ts";

export const configRoute = new Hono<AppEnv>().get("/v1/config", async (c) => {
  const config = await loadConfig(c.env.CONFIG).catch((err: unknown) => {
    if (err instanceof ConfigError) throw new ApiFailure("internal", "config unavailable");
    throw err;
  });
  const body: ConfigResponse = {
    prices: { version: config.prices.version, credits: config.prices.credits },
    routes_version: config.routes.version,
    flags: config.flags,
    min_native: config.min_native,
    voice_pack: config.voice_pack,
  };
  c.header("Cache-Control", "public, max-age=60");
  return c.json(body);
});
