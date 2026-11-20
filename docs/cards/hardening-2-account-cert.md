# Hardening 2: the account certificate (H7a, H7b)

Closes the gap the Sonnet review of PR #104 (M28a) found: a co-member's **account row** is trusted by its `sign_pub` alone (trust on first use), and nothing vouches for its `box_pub`. Device rows carry a certificate signed by the account key; the account row did not certify its own encryption key.

**The attack.** A malicious server (in the threat model, `docs/security.md` section 2) lists Sam's account row in `GET /v1/groups/:id/devices` with Sam's real, already known `sign_pub` and a `box_pub` of its own. Ana's iPhone checks only `knownAccounts["usr_sam"] == sign_pub`, so `wrapGroupKeys` wraps the group key to the server's key. The review proved it with the real `GroupOps.swift`: `refused=[] wrapped=1`, and the attacker's key opened the envelope.

**The fix (both cards).** The account signing key signs its own row:

```
account certificate = ECDSA P-256 (account signing key) over
  context("account-cert", user id, account row id, account sign_pub, account box_pub)
```

the same layout as the device certificate (`context("device-cert", user id, device id, sign_pub, box_pub)`, section 4), with its own label so neither certificate can stand in for the other. The server checks it and stores it in the account row's existing `devices.cert` column (NULL for account rows until now) at the only two places an account row is created: the first device's registration (S1B, `POST /v1/devices`) and the rotation when a device is removed (S1D, `DELETE /v1/devices/:id`). The routes that serve rows already return `cert`, so `GET /v1/devices`, `GET /v1/groups/:id/devices` and the `signers` of `GET /v1/groups/:id/keys` return it with no change. The app wraps a group key for an account row only if the row's `sign_pub` is the person's known account key **and** the certificate verifies under it with the row's `box_pub`; a row with no certificate is refused.

Why this is enough: only the holder of the account signing key can produce a certificate for a `(sign_pub, box_pub)` pair, and the app already pins `sign_pub` (trust on first use). What it does not change: the first time a device sees a person, the server can still present an account key of its own, self-certified ([R1], unchanged; a key-transparency log or MLS would close that).

**Existing rows.** No migration. There are no users in production; account rows made before H7a (development and staging only) keep `cert = NULL`, and co-members' iPhones refuse to wrap for them (and so refuse to start or rotate a group key that must cover them). Reset those databases, or delete the test users, after H7a is deployed. A database CHECK or trigger is not added: SQLite cannot add a CHECK to `devices` without rebuilding the table, and a trigger would break the test seeds that insert account rows directly; the two insert paths above are the only writers.

## Order

| Card | Branch | Area | Merge after |
|---|---|---|---|
| H7a | `fix/h7a-account-cert-server` | `packages/crypto` format and vector, `packages/contracts`, server register and rotation, tests; the app's registration call | `main` at `5473183` or later |
| H7b | `fix/h7b-account-cert-native` | `waypoint-keys` Swift: make, verify, use | H7a (it reads H7a's vector) |

Both merge before M28b (`docs/build-plan.md`, "Build order", Hardening 2). Merge H7b right after H7a: between the two, the native module does not yet return `selfCert`, so a first device cannot register from an app build (nothing can run the native module before Xcode is in place, so in practice this window is empty).

Every block marked **exactly** was applied to a copy of `main` at `5473183` and checked: `npm run typecheck`, `npm test` (crypto 58, contracts 130, api 1005, mobile 287, and the rest unchanged), `npm run bundle -w @waypoint/api`, `npm run export:ios -w @waypoint/mobile`, `npm run test:swift -w @waypoint/mobile` (50 tests), and `swiftc -typecheck Core/*.swift IdentityStore.swift AccountOps.swift GroupOps.swift` in `apps/mobile/modules/waypoint-keys/ios`. The vector was made with H7a's TypeScript and re-checked by a separate script on `node:crypto` (input bytes and signature). A Mac harness compiling the real `IdentityStore.swift`, `AccountOps.swift` and `GroupOps.swift` with a software identity showed: `ensureAccountKey` and `rotateAccountKey` return a `selfCert` that H7a's `verifyAccountCertificate` accepts; `wrapGroupKeys` wraps for a real account row (`1 wrapped, refused []`) and refuses the attack row (`0 wrapped, refused ["acct_sam"]`), a row with a certificate from another key, and a row with no certificate.

---

## H7a · Server and TypeScript: the account certificate format, vector, checks and storage

Branch `fix/h7a-account-cert-server`. Builds on `main` at `5473183`. Follows `AGENTS.md` and the server card rules (`docs/cards/hardening-1.md`, "Server hardening cards"). No dependency, no migration. Files, and no others:

- `packages/crypto/src/certificate.ts`
- `packages/crypto/test/vectors/waypoint-v1.json`, `packages/crypto/test/vectors.test.ts`
- `packages/contracts/src/keys.ts`, `packages/contracts/test/keys.test.ts`
- `apps/api/src/devices/register.ts`, `apps/api/src/devices/remove.ts`
- `apps/api/test/helpers/signing.ts`, `apps/api/test/devices.test.ts`, `apps/api/test/remove-device.test.ts`, `apps/api/test/device-push.test.ts`, `apps/api/test/group-keys.test.ts`
- `apps/mobile/modules/waypoint-keys/src/WaypointKeys.ts` (two types), `apps/mobile/src/platform/device.ts` (one line): the contract change makes `self_cert` required, so the app's first-device registration must send it or `npm run typecheck` fails. H7b makes the native side return it.

`docs/security.md` already describes this (changed in the planning pull request that added this card).

### 1. The format (`packages/crypto/src/certificate.ts`)

Replace the file with, exactly:

```ts
import { fromBase64Url } from "./bytes.ts";
import { context } from "./context.ts";
import { checkId } from "./ids.ts";
import { decodePublicKey, verifyP256 } from "./keys.ts";

// What the account key signs to vouch for one device (docs/security.md, "Device certificates").
export function deviceCertificateInput(userId: string, deviceId: string, signPub: string, boxPub: string): Uint8Array {
  decodePublicKey(signPub);
  decodePublicKey(boxPub);
  return context("device-cert", checkId(userId), checkId(deviceId), signPub, boxPub);
}

// What the account key signs to vouch for its own row: its id and both public keys, so nobody but the holder of the
// account signing key can pair that key with another encryption key (docs/security.md section 6, "Account certificate").
export function accountCertificateInput(userId: string, accountId: string, signPub: string, boxPub: string): Uint8Array {
  decodePublicKey(signPub);
  decodePublicKey(boxPub);
  return context("account-cert", checkId(userId), checkId(accountId), signPub, boxPub);
}

// True only if `cert` is the account signing key's (signPub) signature over accountCertificateInput. Any malformed
// input is false.
export async function verifyAccountCertificate(cert: string, userId: string, accountId: string, signPub: string, boxPub: string): Promise<boolean> {
  try {
    return await verifyP256(decodePublicKey(signPub), fromBase64Url(cert), accountCertificateInput(userId, accountId, signPub, boxPub));
  } catch {
    return false;
  }
}
```

`index.ts` already re-exports the file.

### 2. The published vector (`packages/crypto/test/vectors/waypoint-v1.json`)

Insert this object right after the `device_certificate` object (after its closing `},`, before `"group_key_envelope"`), exactly, two-space indentation like the rest of the file:

```json
  "account_certificate": {
    "user_id": "usr_1",
    "account_id": "acct_1",
    "account_key": "0f56db78ca460b055c500064824bed999a25aaf48ebb519ac201537b85479813101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f",
    "sign_pub": "BOJm3f3BJmjbMNTKPo93SUMsQWBE8tK4wQvz1AEq7_qKv6hkBKLp_-Z9R8WH73qXp_RWuGO00Cz8aSiXOrWxyzk",
    "box_pub": "BI5xyp16YpF75_DbmJa0e_m5HIuGYo7tVdR_51DmXlvLdZN_LvSAkogOqoM1wz80TBgeneF5fyOZVaC7LVb4QJk",
    "signing_input": "776179706f696e742f76312f6163636f756e742d636572740000057573725f310006616363745f310057424f4a6d336633424a6d6a624d4e544b506f393353554d735157424538744b347751767a31414571375f714b7636686b424b4c705f2d5a395238574837337158705f525775474f3030437a38615369584f725778797a6b0057424935787970313659704637355f44626d4a6130655f6d3548497547596f37745664525f3531446d586c764c645a4e5f4c7653416b6f674f716f4d31777a3830544267656e65463566794f5a566143374c566234514a6b",
    "signature": "KHYanXnvmfcBunwaQD9aK1oBL7krDixFHpN1ZgzauQK64HVTY6_P1FsiPOci4odFTgx5gDE6RhHTqlR3LfNomA"
  },
```

`account_key` is the same 64-byte account key as `account_key_envelope.account_key` (signing scalar, then encryption scalar); `sign_pub` is `device_certificate.account_sign_pub`. The signature is one valid ECDSA signature (random, like every signature in the file); do not regenerate it. Nothing else in the file changes.

### 3. Contracts (`packages/contracts/src/keys.ts`)

In `RegisterDeviceRequestSchema`, replace the `account:` line with, exactly:

```ts
    // cert: the account key's certificate for this device. self_cert: the account key's signature over its own row
    // (docs/security.md section 6, "Account certificate").
    account: z
      .strictObject({ id: KeyIdSchema, sign_pub: PublicKeySchema, box_pub: PublicKeySchema, cert: SignatureSchema, self_cert: SignatureSchema })
      .optional(),
```

In `RemoveDeviceRequestSchema`, replace the `account:` line with, exactly:

```ts
    account: z.strictObject({ id: KeyIdSchema, sign_pub: PublicKeySchema, box_pub: PublicKeySchema, self_cert: SignatureSchema }),
```

`DeviceViewSchema`, `GroupDevicesSchema` and `MyGroupKeysSchema` already have `cert: SignatureSchema.nullable()`; for an account row it is now the account certificate. `packages/api-client` takes its types from these schemas, so it needs no change.

### 4. First device (`apps/api/src/devices/register.ts`)

- Import `verifyAccountCertificate` from `@waypoint/crypto` (add it to the existing import, one name per line, alphabetical like the others).
- Replace the line `if (!certOk || req.account.id === req.id) throw new ApiFailure("bad_request", "invalid certificate");` with, exactly:

  ```ts
          // The account row's own certificate: co-members wrap group keys to this box_pub only if it verifies
          // (docs/security.md section 6, "Account certificate").
          const selfOk = await verifyAccountCertificate(req.account.self_cert, user.id, req.account.id, req.account.sign_pub, req.account.box_pub);
          if (!certOk || !selfOk || req.account.id === req.id) throw new ApiFailure("bad_request", "invalid certificate");
  ```

- In the account row's insert, the last bound value changes from `null` to `req.account.self_cert`, exactly:

  ```ts
            db.prepare(insertDevice).bind(req.account.id, user.id, "Account key", "account", req.account.sign_pub, req.account.box_pub, 1, now, "account", now, null, req.account.self_cert),
  ```

### 5. Rotation (`apps/api/src/devices/remove.ts`)

- Import `verifyAccountCertificate` from `@waypoint/crypto` (same way).
- Right after the `try { newSignPub = ... } catch { throw new ApiFailure("bad_request", "invalid request"); }` block and before `const updates = [];`, add exactly:

  ```ts
      // The new account row's own certificate (docs/security.md section 6, "Account certificate").
      if (!(await verifyAccountCertificate(req.account.self_cert, user.id, req.account.id, req.account.sign_pub, req.account.box_pub))) {
        throw new ApiFailure("bad_request", "invalid certificate");
      }
  ```

- The new account row's insert stores it in `cert`. Replace the `INSERT INTO devices ...` statement (the `.prepare(...)` and its `.bind(...)`) with, exactly:

  ```ts
        db
          .prepare(
            `INSERT INTO devices (id, user_id, name, platform, sign_pub, box_pub, can_approve, added_at, kind, approved_at, approved_by, cert)
               SELECT ?, ?, 'Account key', 'account', ?, ?, 1, ?, 'account', ?, ?, ? WHERE ${UNCHANGED_SQL}`,
          )
          .bind(req.account.id, user.id, req.account.sign_pub, req.account.box_pub, now, now, caller.id, req.account.self_cert, ...unchanged),
  ```

The check runs before anything is written, so a bad certificate answers 400 and changes nothing. No other route creates or replaces an account row (`recovery/route.ts` reads it; `pairing.ts` reads its `sign_pub`).

### 6. The app's first-device call

`apps/mobile/modules/waypoint-keys/src/WaypointKeys.ts`, replace the `AccountKey` type line with, exactly:

```ts
// cert: this device's certificate. selfCert: the account key's certificate for its own row (docs/security.md section 6).
export type AccountKey = { accountId: string; signPub: string; boxPub: string; cert: string; selfCert: string };
```

and in `RotatedAccountKey` replace `account: { id: string; signPub: string; boxPub: string };` with `account: { id: string; signPub: string; boxPub: string; selfCert: string };`.

`apps/mobile/src/platform/device.ts`, in `register`, the first-device body becomes, exactly:

```ts
        { ...base, account: { id: account.accountId, sign_pub: account.signPub, box_pub: account.boxPub, cert: account.cert, self_cert: account.selfCert } },
```

### Tests

**`packages/crypto/test/vectors.test.ts`.** Add `accountCertificateInput` and `verifyAccountCertificate` to the import (alphabetical). In `type Vectors`, under `device_certificate`, add exactly:

```ts
  account_certificate: { user_id: string; account_id: string; account_key: string; sign_pub: string; box_pub: string; signing_input: string; signature: string };
```

After the `it("device certificate", ...)` test, add exactly:

```ts
  it("account certificate", async () => {
    const a = v.account_certificate;
    expect(toHex(accountCertificateInput(a.user_id, a.account_id, a.sign_pub, a.box_pub))).toBe(a.signing_input);
    expect(await verifyAccountCertificate(a.signature, a.user_id, a.account_id, a.sign_pub, a.box_pub)).toBe(true);
    // The attack it stops: the known sign_pub with another box_pub (docs/security.md section 6).
    expect(await verifyAccountCertificate(a.signature, a.user_id, a.account_id, a.sign_pub, v.device_certificate.box_pub)).toBe(false);
    expect(await verifyAccountCertificate(a.signature, "usr_2", a.account_id, a.sign_pub, a.box_pub)).toBe(false);
    expect(await verifyAccountCertificate(a.signature, a.user_id, "acct_2", a.sign_pub, a.box_pub)).toBe(false);
    // A device certificate made by the same account key is not an account certificate (another context label).
    const d = v.device_certificate;
    expect(d.account_sign_pub).toBe(a.sign_pub);
    expect(await verifyAccountCertificate(d.signature, d.user_id, d.device_id, a.sign_pub, d.box_pub)).toBe(false);
    expect(await verifyAccountCertificate("not base64url!", a.user_id, a.account_id, a.sign_pub, a.box_pub)).toBe(false);
  });
```

**`packages/contracts/test/keys.test.ts`.** `FIRST_DEVICE.account` gets `self_cert: CERT`; `ROTATION.account` gets `self_cert: CERT`. Add, in the `RegisterDeviceRequestSchema` describe after "an extra key fails", exactly:

```ts
  test("a first device without the account's self_cert fails", () => {
    const { self_cert: _unused, ...account } = FIRST_DEVICE.account;
    expect(RegisterDeviceRequestSchema.safeParse({ ...FIRST_DEVICE, account }).success).toBe(false);
  });
```

and at the end of the `RemoveDeviceRequestSchema` describe, exactly:

```ts
  test("a rotation without the new account's self_cert fails", () => {
    const { self_cert: _unused, ...account } = ROTATION.account;
    expect(RemoveDeviceRequestSchema.safeParse({ ...ROTATION, account }).success).toBe(false);
  });
```

**`apps/api/test/helpers/signing.ts`.** Add `accountCertificateInput` to the `@waypoint/crypto` import (first, alphabetical) and, above `let nonceCounter = 0;`, exactly:

```ts
// The account key's certificate for its own row (docs/security.md section 6, "Account certificate").
export async function selfCertFor(account: TestDevice, userId: string, accountId: string = account.id): Promise<string> {
  return toBase64Url(await account.sign(accountCertificateInput(userId, accountId, account.signPub, account.boxPub)));
}
```

**`apps/api/test/devices.test.ts`.** Import `accountCertificateInput` from `@waypoint/crypto` and `selfCertFor` from `./helpers/signing.ts`. `firstBody` becomes async and sends the certificate, exactly:

```ts
async function firstBody(device: TestDevice, account: TestDevice, cert: string, accountId: string = account.id) {
  return {
    id: device.id,
    name: "Mina's iPhone",
    platform: "ios",
    sign_pub: device.signPub,
    box_pub: device.boxPub,
    account: { id: accountId, sign_pub: account.signPub, box_pub: account.boxPub, cert, self_cert: await selfCertFor(account, "u1", accountId) },
  };
}
```

Every `firstBody(` call becomes `await firstBody(`. In "a first device gives 201, ...", keep the body as `const sent = await firstBody(device, account, cert);`, post `sent`, and expect the account row's `cert: sent.account.self_cert` (it was `null`). Add after the "a first device with a certificate from another key, ..." test, exactly:

```ts
  test("a first device whose account self_cert does not verify gives 400 and no rows; without one, 400 invalid request", async () => {
    const db = await fixture();
    const account = await makeTestDevice("account_1");
    const other = await makeTestDevice("other_1");
    const device = await makeTestDevice("device_1");
    const body = await firstBody(device, account, await certFor(account, "u1", device));
    const cases = [
      // The attack: the account's real sign_pub and self_cert with a box_pub someone else chose.
      { ...body, account: { ...body.account, box_pub: other.boxPub } },
      // The right fields, signed by another key.
      { ...body, account: { ...body.account, self_cert: toBase64Url(await other.sign(accountCertificateInput("u1", "account_1", account.signPub, account.boxPub))) } },
      // Made for another user.
      { ...body, account: { ...body.account, self_cert: await selfCertFor(account, "u2") } },
    ];
    for (const bad of cases) {
      const res = await postDevice(db, "u1", bad, device);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ code: "bad_request", message: "invalid certificate", retry_after: null });
    }
    const { self_cert: _unused, ...noSelfCert } = body.account;
    const missing = await postDevice(db, "u1", { ...body, account: noSelfCert }, device);
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ code: "bad_request", message: "invalid request", retry_after: null });
    expect(await rowsOf(db, "u1")).toEqual([]);
  });
```

**`apps/api/test/remove-device.test.ts`.** Import `selfCertFor`. `rotation`'s options get `selfCert?: string`, and its account becomes, exactly:

```ts
    account: { id: accountId, sign_pub: w.next.signPub, box_pub: w.next.boxPub, self_cert: options.selfCert ?? (await selfCertFor(w.next, "u1", accountId)) },
```

In "phone removes the iPad with a new account key: ...", select `cert` too for `acct_2` and expect `cert: body.account.self_cert`. Add before "an account.id that is already taken ...", exactly:

```ts
  test("a new account key whose self_cert does not verify gets 400 and nothing changes", async () => {
    const w = await world();
    const before = await snapshot(w.db);
    const body = await rotation(w);
    const cases = [
      // The attack: the new key's real sign_pub and self_cert with a box_pub someone else chose.
      { ...body, account: { ...body.account, box_pub: w.ipad.boxPub } },
      // Signed by the old account key.
      await rotation(w, { selfCert: await selfCertFor(w.account, "u1", "acct_2") }),
      // Made for another account row id.
      await rotation(w, { selfCert: await selfCertFor(w.next, "u1", "acct_9") }),
    ];
    for (const bad of cases) {
      const res = await remove(w, w.phone, PATH, bad);
      expect(res.status).toBe(400);
      expect((await errorOf(res)).message).toBe("invalid certificate");
    }
    expect(await snapshot(w.db)).toEqual(before);
  });
```

**`apps/api/test/device-push.test.ts`.** Import `selfCertFor`. The rotation helper's account gets `self_cert: await selfCertFor(next, "u1", "acct_0002")`; the first-device test's account gets `self_cert: await selfCertFor(w.account, "u1", "acct_0001")`. No new test.

**`apps/api/test/group-keys.test.ts`.** Import `verifyAccountCertificate` and `selfCertFor`. Add after the `GET /v1/groups/g1/devices lists the targets ...` test, exactly:

```ts
  test("GET /v1/groups/g1/devices serves an account row's self-certificate as its cert, and it verifies under the row's own keys", async () => {
    const w = await world();
    const selfCert = await selfCertFor(w.d.acct_u2!, "u2");
    await w.db.prepare("UPDATE devices SET cert = ? WHERE id = 'acct_u2'").bind(selfCert).run();
    const res = await appFor(userOf("u1")).request(DEVICES_PATH, {}, { DB: w.db });
    const devices = ((await res.json()) as { devices: { id: string; user_id: string; kind: string; sign_pub: string; box_pub: string; cert: string | null }[] }).devices;
    const row = devices.find((x) => x.id === "acct_u2");
    expect(row).toMatchObject({ kind: "account", user_id: "u2", cert: selfCert });
    expect(await verifyAccountCertificate(selfCert, "u2", "acct_u2", row?.sign_pub ?? "", row?.box_pub ?? "")).toBe(true);
  });
```

Before opening the pull request run, from the repo root, `npm install`, `npm run typecheck`, `npm test`, `npm run bundle -w @waypoint/api` and `npm run export:ios -w @waypoint/mobile`, and paste the last lines of each. Check that the new crypto, devices and remove-device tests fail on `main` (stash the `src` changes and run them).

Not in this PR: any Swift (H7b); a migration or a database constraint (see "Existing rows" above; the comment in `0005_security.sql` that says `cert` is NULL for account rows stays, applied migrations are not edited); checking account certificates on `POST /v1/groups/:id/keys` (the server is not trusted for this; iPhones check); `box_pub` in the `signers` of `GET /v1/groups/:id/keys` (M28a's open question, unchanged).

---

## H7b · Native: make the account certificate, and wrap only for an account row it verifies

Branch `fix/h7b-account-cert-native`. After H7a. Follows `AGENTS.md` and "Rules for every mobile card" (`docs/cards/mobile.md` section 1). No dependency. Files, all under `apps/mobile/modules/waypoint-keys/ios/`, and no others:

- `Core/Signing.swift`, `Core/Account.swift`, `Core/Groups.swift`
- `Tests/Vectors.swift`, `Tests/VectorTests.swift`, `Tests/GroupTests.swift`
- `GroupOps.swift` (M28a's wrap), `IdentityStore.swift` (M26b's `ensureAccountKey`), `AccountOps.swift` (M27b-A's `rotateAccountKey`)

`WaypointKeysModule.swift` and `src/WaypointKeys.ts` do not change: the two functions already return dictionaries, and H7a added `selfCert` to the TypeScript types.

### 1. Format (`Core/Signing.swift`)

Append at the end of the file, exactly:

```swift

// The account key's signature over its own row (docs/security.md section 6, "Account certificate"). Without it, a
// server could list a person's known account sign_pub next to a box_pub of its own choosing and receive group keys.
public enum AccountCertificate {
  public static func input(userId: String, accountId: String, signPub: String, boxPub: String) throws -> Data {
    _ = try PublicKeys.raw(signPub)
    _ = try PublicKeys.raw(boxPub)
    return try context("account-cert", [try checkId(userId), try checkId(accountId), signPub, boxPub])
  }

  public static func sign(_ accountKey: some SigningKey, userId: String, accountId: String, boxPub: String) throws -> String {
    Base64URL.encode(try accountKey.sign(try input(userId: userId, accountId: accountId, signPub: accountKey.publicKeyText, boxPub: boxPub)))
  }

  // Verified under the row's own sign_pub; the caller separately checks that sign_pub is the person's known account key.
  public static func verify(cert: String, userId: String, accountId: String, signPub: String, boxPub: String) -> Bool {
    guard let key = try? PublicKeys.signing(signPub), let sig = try? Base64URL.decode(cert),
      let message = try? input(userId: userId, accountId: accountId, signPub: signPub, boxPub: boxPub)
    else { return false }
    return verifyP256(key, signature: sig, message: message)
  }
}
```

### 2. Making it (`Core/Account.swift`)

In `AccountKey`, right after `public var boxPub: String { boxKeyText(box.publicKey) }`, add exactly:

```swift

  // The certificate for this key's own row (self_cert in POST /v1/devices and DELETE /v1/devices/:id).
  public func selfCertificate(userId: String, accountId: String) throws -> String {
    try AccountCertificate.sign(sign, userId: userId, accountId: accountId, boxPub: boxPub)
  }
```

### 3. Checking it (`Core/Groups.swift`)

In `GroupKeys`, right after `trusted(_:knownAccounts:)`, add exactly:

```swift

  // An account row is a wrapping target only if its sign_pub is the account key this iPhone already knows for that
  // person and its own certificate covers its box_pub (section 6, "Account certificate").
  public static func trustedAccount(id: String, userId: String, signPub: String, boxPub: String, cert: String, knownAccounts: [String: String]) -> Bool {
    guard let account = knownAccounts[userId], account == signPub else { return false }
    return AccountCertificate.verify(cert: cert, userId: userId, accountId: id, signPub: signPub, boxPub: boxPub)
  }
```

### 4. Using it (`GroupOps.swift`, `wrapGroupKeys`)

Replace the comment above `wrapGroupKeys` with, exactly:

```swift
  // Wraps the held keys for each recipient that is trusted (docs/security.md section 6): an account row whose sign
  // key is the person's known account key and whose own certificate verifies under it, or a device whose certificate
  // verifies under it. Others are refused.
```

and the `case "account"` line with, exactly:

```swift
      case "account": trusted = GroupKeys.trustedAccount(id: id, userId: personId, signPub: signPub, boxPub: boxPub, cert: cert, knownAccounts: knownAccounts)
```

`cert` is already required for every recipient; the TypeScript wrapper sends `""` for a NULL `cert`, which never verifies. `openGroupKeys` does not change: it uses only a signer's `sign_pub`, never its `box_pub`.

### 5. Producing it (`IdentityStore.swift`, `AccountOps.swift`)

`IdentityStore.swift`, `ensureAccountKey` (first device, M26b). Replace its comment with, exactly:

```swift
  // First device only: makes the account key (software P-256, docs/security.md section 5), keeps it with the
  // device keys, certifies this device and the account row itself (selfCert). Returns the existing account key when
  // there is one.
```

and its `return` line with, exactly:

```swift
    let selfCert = try AccountCertificate.sign(sign, userId: userId, accountId: id, boxPub: boxKeyText(box.publicKey))
    return ["accountId": id, "signPub": sign.publicKeyText, "boxPub": boxKeyText(box.publicKey), "cert": cert, "selfCert": selfCert]
```

`AccountOps.swift`, `rotateAccountKey` (device removal, M27b-A). Replace its comment with, exactly:

```swift
  // Removing an approved device (docs/security.md section 12): a new account key, kept pending, with its own
  // certificate (selfCert), and a certificate and an account-key envelope (signed by this device) for every device
  // that stays.
```

and its `return` line with, exactly:

```swift
    let selfCert = try key.selfCertificate(userId: userId, accountId: try checkId(accountId))
    return ["account": ["id": accountId, "signPub": key.signPub, "boxPub": key.boxPub, "selfCert": selfCert], "devices": out]
```

Recovery (`recoverAccountKey`, `certifyDevice(asAccount:)`) and approval do not create an account row, so they do not change. Whoever wires the removal flow (M27b-C or M28b) sends `rotated.account.selfCert` as `account.self_cert` in `DELETE /v1/devices/:id`; H7a's contract makes it required.

### Tests

**`Tests/Vectors.swift`.** In `WaypointV1`, after `struct Certificate`, add exactly:

```swift
  struct AccountCert: Decodable {
    let user_id: String, account_id: String, account_key: String, sign_pub: String, box_pub: String, signing_input: String, signature: String
  }
```

and after `let device_certificate: Certificate` add `let account_certificate: AccountCert`.

**`Tests/VectorTests.swift`.** After `deviceCertificate()`, add exactly:

```swift
@Test func accountCertificate() throws {
  let a = v.account_certificate
  #expect(try AccountCertificate.input(userId: a.user_id, accountId: a.account_id, signPub: a.sign_pub, boxPub: a.box_pub).hex == a.signing_input)
  #expect(AccountCertificate.verify(cert: a.signature, userId: a.user_id, accountId: a.account_id, signPub: a.sign_pub, boxPub: a.box_pub))
  // The attack it stops: the known sign_pub with another box_pub.
  #expect(!AccountCertificate.verify(cert: a.signature, userId: a.user_id, accountId: a.account_id, signPub: a.sign_pub, boxPub: v.device_certificate.box_pub))
  #expect(!AccountCertificate.verify(cert: a.signature, userId: "usr_2", accountId: a.account_id, signPub: a.sign_pub, boxPub: a.box_pub))
  #expect(!AccountCertificate.verify(cert: a.signature, userId: a.user_id, accountId: "acct_2", signPub: a.sign_pub, boxPub: a.box_pub))
  // The vector's 64-byte account key is the row's two keys, and our own self-certificate verifies.
  let key = try AccountKey(raw: Data(hex: a.account_key))
  #expect(key.signPub == a.sign_pub && key.boxPub == a.box_pub)
  let mine = try key.selfCertificate(userId: a.user_id, accountId: a.account_id)
  #expect(AccountCertificate.verify(cert: mine, userId: a.user_id, accountId: a.account_id, signPub: a.sign_pub, boxPub: a.box_pub))
}
```

**`Tests/GroupTests.swift`.** Before `lockedContentWithAGroupKeyRoundTrips()`, add exactly:

```swift
@Test func anAccountRowIsTrustedOnlyWithItsOwnCertificate() throws {
  let userId = "usr_sam"
  let account = AccountKey()
  let known = [userId: account.signPub]
  let cert = try account.selfCertificate(userId: userId, accountId: "acct_sam")
  #expect(GroupKeys.trustedAccount(id: "acct_sam", userId: userId, signPub: account.signPub, boxPub: account.boxPub, cert: cert, knownAccounts: known))
  // The attack (review of #104): the known sign_pub and its real certificate, with a box_pub the server chose.
  let attacker = boxKeyText(P256.KeyAgreement.PrivateKey().publicKey)
  #expect(!GroupKeys.trustedAccount(id: "acct_sam", userId: userId, signPub: account.signPub, boxPub: attacker, cert: cert, knownAccounts: known))
  // The same, with a certificate signed by a key the server holds.
  let forged = try AccountCertificate.sign(P256.Signing.PrivateKey(), userId: userId, accountId: "acct_sam", boxPub: attacker)
  #expect(!GroupKeys.trustedAccount(id: "acct_sam", userId: userId, signPub: account.signPub, boxPub: attacker, cert: forged, knownAccounts: known))
  // No certificate (a row made before this check, served as ""), another row id, an unknown or changed account key.
  #expect(!GroupKeys.trustedAccount(id: "acct_sam", userId: userId, signPub: account.signPub, boxPub: account.boxPub, cert: "", knownAccounts: known))
  #expect(!GroupKeys.trustedAccount(id: "acct_other", userId: userId, signPub: account.signPub, boxPub: account.boxPub, cert: cert, knownAccounts: known))
  #expect(!GroupKeys.trustedAccount(id: "acct_sam", userId: userId, signPub: account.signPub, boxPub: account.boxPub, cert: cert, knownAccounts: [:]))
  let changed = AccountKey()
  let changedCert = try changed.selfCertificate(userId: userId, accountId: "acct_sam")
  #expect(!GroupKeys.trustedAccount(id: "acct_sam", userId: userId, signPub: changed.signPub, boxPub: changed.boxPub, cert: changedCert, knownAccounts: known))
  // A device certificate is not an account certificate, even from the same key.
  let deviceCert = try DeviceCertificate.sign(account.sign, userId: userId, deviceId: "acct_sam", signPub: account.signPub, boxPub: account.boxPub)
  #expect(!GroupKeys.trustedAccount(id: "acct_sam", userId: userId, signPub: account.signPub, boxPub: account.boxPub, cert: deviceCert, knownAccounts: known))
}
```

Before opening the pull request run, from the repo root, `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile` and `npm run test:swift -w @waypoint/mobile` (50 tests), and, in `apps/mobile/modules/waypoint-keys/ios`, `swiftc -typecheck Core/*.swift IdentityStore.swift AccountOps.swift GroupOps.swift` (exit 0); paste the last lines of each.

### Device check

Each step passed, failed, or "not run: no Xcode yet".

1. Fresh install, sign in as a new user on the first iPhone: registration succeeds (the server now refuses a first device without a valid `self_cert`), and `GET /v1/devices` shows the account row with a non-null `cert`.
2. With M28b in place (or a dev call to `wrapGroupKeys`): a recipient list with a co-member's account row whose `boxPub` is replaced by another key, `cert` unchanged, returns that row in `refused` and no envelope for it; the unmodified row is wrapped.
3. Remove a device from another one (once the removal flow is wired): the new account row has a non-null `cert`, and a co-member's iPhone still wraps for it after accepting the "security key changed" notice.

Not in this PR: a `verifyAccountCertificate` bridge function (JavaScript does not need it: the native wrap decides); accepting an account row as the **signer** of a group-key envelope (`GroupKeys.open` checks signers by device certificate only; M28b decides, see `docs/security.md` section 6); any change to `openGroupKeys`, recovery or pairing; M28b's `known_accounts` (it keeps recording the first `sign_pub` it sees; the certificate is checked where keys are wrapped).
