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
    // cert: the account key's certificate for this device. self_cert: the account key's signature over its own row
    // (docs/security.md section 6, "Account certificate").
    account: z
      .strictObject({ id: KeyIdSchema, sign_pub: PublicKeySchema, box_pub: PublicKeySchema, cert: SignatureSchema, self_cert: SignatureSchema })
      .optional(),
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

export const DeviceListSchema = z.strictObject({ user_id: KeyIdSchema, devices: z.array(DeviceViewSchema) });

// S1C: pairing and approval.
export const PairingNonceRequestSchema = z.strictObject({ nonce: Bytes32Schema });
export const PairingViewSchema = z.strictObject({
  device_id: KeyIdSchema,
  commitment: Bytes32Schema,
  expires_at: z.number().int(),
  approver: z.strictObject({ id: KeyIdSchema, sign_pub: PublicKeySchema }).nullable(),
  approver_nonce: Bytes32Schema.nullable(),
  device_nonce: Bytes32Schema.nullable(),
});
export type PairingView = z.infer<typeof PairingViewSchema>;

export const GroupEnvelopeSchema = z.strictObject({
  group_id: KeyIdSchema,
  key_version: z.number().int().min(1),
  wrapped_key: EnvelopeTextSchema,
});
export const ApproveDeviceRequestSchema = z.strictObject({
  cert: SignatureSchema,
  account_envelope: EnvelopeTextSchema,
  envelopes: z.array(GroupEnvelopeSchema).max(500),
});

// S3: recovery.
export const RecoveryBlobSchema = z.string().regex(/^[A-Za-z0-9_-]{124}$/); // 93 bytes
export const PutRecoveryRequestSchema = z.strictObject({
  account_device_id: KeyIdSchema,
  wrapped_account_key: RecoveryBlobSchema,
  verified: z.boolean(),
});
export const RecoveryViewSchema = z.strictObject({
  account_device_id: KeyIdSchema,
  sign_pub: PublicKeySchema,
  box_pub: PublicKeySchema,
  wrapped_account_key: RecoveryBlobSchema,
  verified_at: z.number().int().nullable(),
});

// S1D: removing a device.
export const RemoveDeviceRequestSchema = z.union([
  z.strictObject({}),
  z.strictObject({
    account: z.strictObject({ id: KeyIdSchema, sign_pub: PublicKeySchema, box_pub: PublicKeySchema, self_cert: SignatureSchema }),
    devices: z.array(z.strictObject({ id: KeyIdSchema, cert: SignatureSchema, account_envelope: EnvelopeTextSchema })).min(1).max(50),
  }),
]);
export const RemoveDeviceResponseSchema = z.strictObject({ removed: KeyIdSchema, account_id: KeyIdSchema.nullable() });

// S2: group keys.
export const GroupKeysRequestSchema = z.strictObject({
  key_version: z.number().int().min(1),
  envelopes: z.array(z.strictObject({ device_id: KeyIdSchema, wrapped_key: EnvelopeTextSchema })).min(1).max(500),
});
export const GroupKeysResponseSchema = z.strictObject({ key_version: z.number().int().min(1), first: z.boolean() });
export const GroupDevicesSchema = z.strictObject({
  key_version: z.number().int().min(1),
  devices: z.array(
    z.strictObject({
      id: KeyIdSchema,
      user_id: KeyIdSchema,
      kind: z.enum(["device", "account"]),
      role: z.enum(["owner", "editor", "viewer"]),
      sign_pub: PublicKeySchema,
      box_pub: PublicKeySchema,
      cert: SignatureSchema.nullable(),
      has_current_key: z.boolean(),
    }),
  ),
});
export const MyGroupKeysSchema = z.strictObject({
  key_version: z.number().int().min(1),
  envelopes: z.array(z.strictObject({ key_version: z.number().int().min(1), wrapped_key: EnvelopeTextSchema })),
  signers: z.array(
    z.strictObject({ id: KeyIdSchema, user_id: KeyIdSchema, kind: z.enum(["device", "account"]), sign_pub: PublicKeySchema, cert: SignatureSchema.nullable() }),
  ),
});
