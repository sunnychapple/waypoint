import { z } from "zod";

// PR 27: groups, invites and membership. Ids chosen by the device are random (a UUID is fine); a group id is at most
// 48 characters so it fits a push message's ref.
export const GroupIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,48}$/);
export const UserIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const GroupRoleSchema = z.enum(["owner", "editor", "viewer"]);
export const GroupKindSchema = z.enum(["personal", "shared"]);
// The group's name locked with the group key (docs/security.md, section 11), base64url. The server never reads it.
export const LockedNameSchema = z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/);
// What the invitee gets: 32 random bytes, base64url. The server only ever stores its SHA-256 (lowercase hex).
export const InviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const TokenHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

const Millis = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const CreateGroupRequestSchema = z.strictObject({ id: GroupIdSchema, kind: GroupKindSchema, name_locked: LockedNameSchema });

export const MemberViewSchema = z.strictObject({
  user_id: UserIdSchema,
  role: GroupRoleSchema,
  starts_at: Millis,
  ends_at: Millis.nullable(),
  history_from: Millis,
});

export const GroupViewSchema = z.strictObject({
  id: GroupIdSchema,
  kind: GroupKindSchema,
  name_locked: LockedNameSchema,
  key_version: z.number().int().min(1),
  created_by: UserIdSchema.nullable(),
  role: GroupRoleSchema,
  members: z.array(MemberViewSchema),
});
export type GroupView = z.infer<typeof GroupViewSchema>;

export const GroupListSchema = z.strictObject({ groups: z.array(GroupViewSchema) });

export const CreateInviteRequestSchema = z.strictObject({
  token_hash: TokenHashSchema,
  role: GroupRoleSchema,
  history_from: Millis,
  ends_at: Millis.nullable(),
});

export const InviteViewSchema = z.strictObject({
  group_id: GroupIdSchema,
  role: GroupRoleSchema,
  history_from: Millis,
  ends_at: Millis.nullable(),
  expires_at: Millis,
});

export const MembershipEndedSchema = z.strictObject({
  group_id: GroupIdSchema,
  user_id: UserIdSchema,
  key_version: z.number().int().min(1),
});
