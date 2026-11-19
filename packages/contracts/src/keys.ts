import { z } from "zod";

// Request and reply shapes for devices, group keys and recovery (docs/security.md). Byte strings are base64url
// without padding; the lengths below are the encoded lengths.
export const KeyIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const PublicKeySchema = z.string().regex(/^[A-Za-z0-9_-]{87}$/); // 65-byte SEC1 uncompressed P-256 point
export const SignatureSchema = z.string().regex(/^[A-Za-z0-9_-]{86}$/); // 64-byte ECDSA r || s
export const Bytes32Schema = z.string().regex(/^[A-Za-z0-9_-]{43}$/); // 32 bytes: pairing nonces and commitments
export const EnvelopeTextSchema = z.string().regex(/^[A-Za-z0-9_-]{1,512}$/);

export const RegisterDeviceRequestSchema = z
  .strictObject({
    id: KeyIdSchema,
    name: z.string().min(1).max(64),
    platform: z.literal("ios"),
    sign_pub: PublicKeySchema,
    box_pub: PublicKeySchema,
    commitment: Bytes32Schema.optional(),
    account: z.strictObject({ id: KeyIdSchema, sign_pub: PublicKeySchema, box_pub: PublicKeySchema, cert: SignatureSchema }).optional(),
  })
  .refine((r) => (r.commitment === undefined) !== (r.account === undefined), {
    message: "send commitment (a new device) or account (the first device), not both",
  });
export type RegisterDeviceRequest = z.infer<typeof RegisterDeviceRequestSchema>;

export const DeviceViewSchema = z.strictObject({
  id: KeyIdSchema,
  kind: z.enum(["device", "account"]),
  name: z.string(),
  platform: z.string(),
  sign_pub: PublicKeySchema,
  box_pub: PublicKeySchema,
  cert: SignatureSchema.nullable(),
  account_envelope: EnvelopeTextSchema.nullable(),
  added_at: z.number().int(),
  approved_at: z.number().int().nullable(),
  approved_by: KeyIdSchema.nullable(),
});
export type DeviceView = z.infer<typeof DeviceViewSchema>;

export const DeviceListSchema = z.strictObject({ devices: z.array(DeviceViewSchema) });
