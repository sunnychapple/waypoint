import { PriceTableSchema, type PriceTable } from "@waypoint/pricing";
import { RouteTableSchema, type RouteTable } from "@waypoint/router";
import { z } from "zod";
import {
  ConfigCurrentSchema,
  FlagsSchema,
  MinNativeSchema,
  RouterConfigSchema,
  VoicePackSchema,
} from "./schemas.ts";

export type ConfigKv = {
  get(key: string, options: { type: "json"; cacheTtl: number }): Promise<unknown>;
};

export type LoadedConfig = {
  prices: PriceTable;
  routes: RouteTable;
  router: z.infer<typeof RouterConfigSchema>;
  flags: Record<string, boolean>;
  min_native: { ios: string };
  voice_pack: z.infer<typeof VoicePackSchema>;
};

export class ConfigError extends Error {
  readonly key: string;

  constructor(key: string, reason: string) {
    super(`config ${key}: ${reason}`);
    this.name = "ConfigError";
    this.key = key;
  }
}

async function read(kv: ConfigKv, key: string): Promise<unknown> {
  const value = await kv.get(key, { type: "json", cacheTtl: 60 });
  if (value === null || value === undefined) throw new ConfigError(key, "missing");
  return value;
}

function parse<S extends z.ZodType>(key: string, schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ConfigError(key, "invalid");
  return result.data;
}

export async function loadConfig(kv: ConfigKv): Promise<LoadedConfig> {
  const current = parse("config:current", ConfigCurrentSchema, await read(kv, "config:current"));
  const pricesKey = `config:prices:${current.prices}`;
  const routesKey = `config:routes:${current.routes}`;

  const [pricesRaw, routesRaw, routerRaw, flagsRaw, minNativeRaw, voicePackRaw] = await Promise.all([
    read(kv, pricesKey),
    read(kv, routesKey),
    read(kv, "config:router"),
    read(kv, "config:flags"),
    read(kv, "config:min-native"),
    read(kv, "config:voice-pack"),
  ]);

  const prices = parse(pricesKey, PriceTableSchema, pricesRaw);
  if (prices.version !== current.prices) throw new ConfigError(pricesKey, "version mismatch");
  const routes = parse(routesKey, RouteTableSchema, routesRaw);
  if (routes.version !== current.routes) throw new ConfigError(routesKey, "version mismatch");

  return {
    prices,
    routes,
    router: parse("config:router", RouterConfigSchema, routerRaw),
    flags: parse("config:flags", FlagsSchema, flagsRaw),
    min_native: parse("config:min-native", MinNativeSchema, minNativeRaw),
    voice_pack: parse("config:voice-pack", VoicePackSchema, voicePackRaw),
  };
}
