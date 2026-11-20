import { z } from "zod";
import { GroupIdSchema } from "./groups.ts";

// PR 29: locked media. The device picks the blob id (it is part of the file's AAD, docs/security.md section 11).
export const BlobIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
export const BlobStoredSchema = z.strictObject({ id: BlobIdSchema, group_id: GroupIdSchema, bytes: z.number().int().min(1) });
