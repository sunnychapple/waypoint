import { z } from "zod";
import { GroupIdSchema } from "./groups.ts";

// PR 30: shared links. The device picks the link id (it is part of the data's AAD, docs/security.md section 11);
// 22 characters is 16 random bytes.
export const LinkIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);
// Locked link data, base64url: 33 bytes to 4 MiB. The length is checked first (and stops there), then the characters
// with a regex that has no quantifier: /^[A-Za-z0-9_-]{44,5592406}$/ overflows V8's regexp stack at about 5.59 million
// characters ("Maximum call stack size exceeded"), which made an oversized link a 500 instead of a 400.
export const LinkDataSchema = z
  .string()
  .min(44)
  .max(5_592_406, { abort: true })
  .refine((data) => !/[^A-Za-z0-9_-]/.test(data));
// Printable ASCII without spaces, so it travels in a header unchanged.
export const LinkPasscodeSchema = z.string().regex(/^[!-~]{4,64}$/);

export const LINK_PASSCODE_HEADER = "Waypoint-Link-Passcode";
export const LINK_TURNSTILE_HEADER = "Waypoint-Turnstile";

export const CreateLinkRequestSchema = z.strictObject({
  id: LinkIdSchema,
  group_id: GroupIdSchema,
  data: LinkDataSchema,
  passcode: LinkPasscodeSchema.nullable(),
  expires_at: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
});

export const LinkViewSchema = z.strictObject({
  id: LinkIdSchema,
  group_id: GroupIdSchema,
  has_passcode: z.boolean(),
  expires_at: z.number().int().nullable(),
  created_at: z.number().int(),
});

export const LinkRevokedSchema = z.strictObject({ id: LinkIdSchema, revoked_at: z.number().int() });
