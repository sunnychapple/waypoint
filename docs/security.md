# Waypoint security design

Status: proposed, 19 Nov 2026. Written for an outside security review. **It must be reviewed before real students use it.** Choices that most need the reviewer's eye are marked **[R1]** to **[R15]** and listed in section 17.

Decided by the product owner (19 Nov 2026): only well-known algorithms and the platform's own crypto (Apple CryptoKit on iOS, WebCrypto on Cloudflare Workers); no home-made primitives. Implementation cards: `docs/cards/security.md`. Spec context: `docs/architecture.md` (zones, flows 2, 3, 4, 7, section 5).

Users are K-12 students studying at home, sometimes helped by a parent. There is one app, on iPhone and iPad. There is no web sign-in except the read-only shared-link viewer.

## 1. Summary

- Every device has two Secure Enclave keys: a **signing key** and an **encryption key**, both P-256.
- Every account has an **account key**: a P-256 signing key and a P-256 encryption key, held by the user's approved devices and, wrapped, by the **12-word recovery key**. The account key vouches for the user's devices (a *device certificate*) and for its own encryption key (an *account certificate*), and receives a copy of every group key, so recovery works without any device.
- Every group (a personal space or a shared one) has a random 256-bit **group key per key version**. Notes, changes, snapshots, media and the group's name are encrypted with AES-256-GCM under it. The key is wrapped for each device and account key with **HPKE** (RFC 9180) and signed by the device that wrapped it.
- A new device is approved by an existing device after the person compares a **6-digit code** on both screens. The code comes from a commit-then-reveal exchange, so the server cannot make both screens agree on a key it chose.
- Requests that change devices, keys, group membership or money are **signed** by the device's Secure Enclave key, with a timestamp and a single-use nonce.
- Results of cloud jobs are **sealed** with HPKE to the device that asked, before they are stored.
- Removing a member or a device bumps the **key version** of the affected groups; the remaining devices make a new key and only they receive it.

## 2. Threat model

| Who | Can see | Cannot see |
|---|---|---|
| Waypoint's server code and staff, honest but curious | Everything in "What is not protected" (section 16). The plain text of a cloud task while it runs (the person chose to send it). Audio during a second-transcript job. | Notes, transcripts, pages, photos, group names, flashcards, search index. Stored job results after sealing. |
| Someone with a copy of D1, R2 or KV (a breach) | The same metadata. Ciphertext. Public keys. | Any content or key. The recovery blob needs the 12 words (128 bits). Link passcodes are peppered (the pepper is not in D1). |
| Cloudflare | Same as our server: it runs our code and terminates TLS. | Same as our server. |
| An actively malicious server **[R1]** | Can withhold, reorder or replay locked changes (section 11). Can lie about who is in a group or which devices a user has; other members' devices only accept a device certified by an account key they have already seen (trust on first use), so the server can add a device only for a user nobody has met yet or at the moment a user's account key really changes. | Cannot get its own key accepted when a person adds their own device (6-digit code). Cannot forge an envelope, a device certificate, an account certificate or a signed request. Cannot pair a person's known account key with an encryption key of its own (account certificate, section 6). |
| A thief with a **locked** phone | Nothing beyond the lock screen. Keys are usable only after the first unlock, and the app needs the passcode to open. | Everything. |
| A thief with an **unlocked** phone, before it is removed | Everything that phone can show; it is a trusted device. | — |
| The same phone **after** the person removes it from another device | What it had already downloaded. Its Clerk session can still read ciphertext and metadata until it expires **[R13]**. | Anything written after removal: every group the user is in gets a new key version, the account key is replaced, and the server refuses the removed device's signatures. |
| A member removed from a group | What they saw while a member, including older key versions they hold. | Anything written after removal (new key version, not wrapped for their devices or account key). |
| A holder of a shared link | The one item behind that link (it is encrypted with its own key, which is in the URL fragment). | Anything else in the group. With a passcode set, they also need the passcode, checked by the server **[R10]**. |
| Someone with a stolen Clerk session only (no phone) | Ciphertext and metadata through `GET` endpoints; the recovery blob. They can register a device, but it stays waiting. | Cannot get a device approved, remove devices, change keys or membership, spend or buy credits: those need a device signature (or the recovery words). |

Out of scope: a compromised iOS or Secure Enclave, a malicious app build (App Store and over-the-air bundles; over-the-air bundles never contain the native crypto module), side channels on the phone, and denial of service by the server.

## 3. Algorithms and libraries

| Use | Algorithm | iOS (CryptoKit) | Worker / browser |
|---|---|---|---|
| Device and account signatures | ECDSA P-256 with SHA-256; signature is `r ‖ s`, 64 bytes | `SecureEnclave.P256.Signing.PrivateKey`, `.signature(for:).rawRepresentation` | WebCrypto `ECDSA` / `P-256` / `SHA-256` (`verify` takes `r ‖ s`) |
| Wrapping keys for a device, sealing job results | HPKE base mode, DHKEM(P-256, HKDF-SHA256) `0x0010`, HKDF-SHA256 `0x0001`, AES-256-GCM `0x0002` | `HPKE.Ciphersuite.P256_SHA256_AES_GCM_256` (iOS 17+); the recipient key is `SecureEnclave.P256.KeyAgreement.PrivateKey`, which conforms to `HPKEDiffieHellmanPrivateKey` | `@hpke/core` 1.9.0 with `@hpke/common` 1.10.1, on WebCrypto `ECDH` P-256, `HMAC`, `AES-GCM` |
| Content | AES-256-GCM, 96-bit random nonce, 128-bit tag | `AES.GCM` | WebCrypto `AES-GCM` |
| Recovery key derivation | HKDF-SHA256 (RFC 5869) | `HKDF<SHA256>` | WebCrypto `HKDF` |
| Commitments, codes, body hashes | SHA-256 | `SHA256` | WebCrypto `digest` |
| Link passcode check | HMAC-SHA256 with a server pepper | — | WebCrypto `HMAC` |
| Recovery words | BIP-39 English word list (2,048 words, file SHA-256 `2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda`) | the app ships the list | not used on the server |

**Why P-256 and not X25519/Ed25519 [R2].** The Secure Enclave only holds P-256 keys (signing and key agreement). Keeping the device keys in the Secure Enclave, so they cannot be copied off the phone, matters more here than the small advantages of the 25519 curves. Workers support ECDSA and ECDH on P-256 in WebCrypto. One curve everywhere keeps the code and the review small.

**Why a library for HPKE [R3].** HPKE's key schedule needs HKDF-Extract and HKDF-Expand as separate steps, which WebCrypto does not expose; writing it ourselves would be home-made protocol code. `@hpke/core` (github.com/dajiaji/hpke-js) uses only WebCrypto, runs on Workers, and is checked in our tests against the RFC 9180 test vector for exactly our suite. Versions are pinned and were published more than 14 days before 19 Nov 2026. We are not aware of a published audit of it; the reviewer should say whether that is acceptable. If not, the fallback is the same construction written on WebCrypto HMAC and checked against the same vectors.

**Checked in a prototype (19 Nov 2026):** the TypeScript reference code in the cards passed the RFC 9180 vector (P-256, SHA-256, AES-256-GCM, base mode), all 262 Wycheproof `ecdsa_secp256r1_sha256_p1363` cases, and every Waypoint vector (section 18); the Waypoint vectors were also re-derived by a separate script written only on `node:crypto` (including HPKE re-implemented from the RFC text and checked against the RFC vector). The sealing and signature code also ran inside `workerd` (wrangler 4.164.0, `wrangler dev`) and produced the same bytes, and the API bundles with `wrangler deploy --dry-run`.

## 4. Encodings

- **Bytes in JSON and in D1** are base64url without padding. Decoders reject padding, the `+/` alphabet and non-canonical text.
- **Public keys** are the 65-byte SEC1 uncompressed point `04 ‖ X ‖ Y` (CryptoKit `x963Representation`, WebCrypto `raw`): 87 base64url characters. Importing a point that is not on the curve fails.
- **Signatures** are 64 bytes, `r ‖ s` (86 characters). ECDSA signatures are malleable (`s` and `n − s`); nothing here uses a signature as an identifier, so that does not matter.
- **Ids** (users, devices, groups, jobs, links, blobs) match `^[A-Za-z0-9_-]{1,64}$`. Device ids are chosen by the device (a random UUID) so it can sign over its own id before the server sees it.
- **Context strings.** Every signature input, HPKE `info`, HKDF `info` and AES-GCM AAD starts with a context, so a value made for one purpose cannot be used for another:

  ```
  context(label, f1, f2, ...) = "waypoint/v1/" ‖ label ‖ 0x00 ‖ u16(len f1) ‖ f1 ‖ u16(len f2) ‖ f2 ‖ ...
  ```
  `label` matches `[a-z0-9-]{1,32}`; fields are UTF-8 strings; `u16` is big-endian. Numbers are written in decimal (key version `3` is the field `"3"`). Public keys inside a context are their base64url text.

  | Label | Fields | Used for |
  |---|---|---|
  | `request` | method, path and query, device id, timestamp, nonce, body SHA-256 (hex) | request signatures (section 7) |
  | `pair-commit` | new sign_pub, new box_pub, new nonce | pairing commitment (section 8) |
  | `pair-code` | new sign_pub, new box_pub, approver sign_pub, approver nonce, new nonce | the 6-digit code |
  | `device-cert` | user id, device id, sign_pub, box_pub | device certificate (section 6) |
  | `account-cert` | user id, account key row id, account sign_pub, account box_pub | account certificate (section 6) |
  | `group-key` | group id, key version, recipient device id | HPKE info of a group-key envelope |
  | `account-key` | user id, account key row id, recipient device id | HPKE info of an account-key envelope |
  | `envelope-sig` | (none) | prefix of an envelope signature |
  | `result` | job id, device id | HPKE info of a sealed job result |
  | `recovery-key` | user id | HKDF info for the recovery wrapping key |
  | `recovery` | user id, account key row id | AAD of the recovery blob |
  | `change`, `snapshot`, `blob`, `group-name`, `link` | see section 11 | AAD of locked content |
  | `link-passcode` | link id, passcode | HMAC input for a link passcode |

## 5. Keys

| Key | Type | Where it lives | What it is for | Replaced when |
|---|---|---|---|---|
| Device signing key | P-256 ECDSA, Secure Enclave | One device; never leaves it | Signs requests, envelopes, pairing steps | The app is deleted or the device is removed |
| Device encryption key (`box`) | P-256 key agreement, Secure Enclave | One device | Receives group keys, the account key and job results (HPKE) | Same |
| Account signing key | P-256 ECDSA, software | Keychain on every approved device of the user (this device only, after first unlock); wrapped in the recovery blob | Signs device certificates and its own row's account certificate; signs a device approval during recovery | A device that held it is removed |
| Account encryption key | P-256 key agreement, software | Same | Receives a copy of every group key the user can read, for recovery | Same |
| Group key, one per key version | 32 random bytes | Keychain on each device that can read the group | AES-256-GCM for everything in the group | A member or a member's device is removed (new version) |
| Recovery key | 16 random bytes shown as 12 BIP-39 words | On paper, with the person | Wraps the account key | The person makes a new one; after the account key is replaced |
| Link key | 32 random bytes | In the shared URL's fragment only | AES-256-GCM for the one linked item | Never; a new link has a new key |
| Link passcode pepper | 32 random bytes | A Worker secret (`LINK_PASSCODE_PEPPER`, set with `wrangler secret put`) | HMAC of link passcodes | Rotated by hand; old links then need a new passcode |

The two account keys are stored together as 64 bytes: the signing scalar, then the encryption scalar (CryptoKit `rawRepresentation` of each private key).

**Simulator and test builds** have no Secure Enclave. They use software keys in the Keychain with `ThisDeviceOnly`; release builds refuse to run without the Secure Enclave.

## 6. The account key row, device certificates and the account certificate

The server keeps the account key's public halves as a row in `devices` with `kind = 'account'` (one active row per user, enforced by a unique index). That row can receive envelopes like any device, so "wrap the group key for every device of every member" automatically includes each member's recovery copy.

Each approved device has a **certificate**: the account signing key's signature over `context("device-cert", user id, device id, sign_pub, box_pub)`, stored in `devices.cert`.

**Account certificate [R15].** The account row certifies itself: the account signing key's signature over `context("account-cert", user id, account row id, sign_pub, box_pub)`, stored in the account row's `devices.cert` and sent as `self_cert` when the row is created (`POST /v1/devices` for the first device, `DELETE /v1/devices/:id` when the account key is replaced; no other path creates an account row). The server verifies it before writing; every route that lists rows returns it as `cert`. Without it, a co-member's account row was trusted by its `sign_pub` alone: a malicious server could list a person's real, already known account `sign_pub` next to a `box_pub` of its own and receive every group key wrapped for that row (found by the review of PR #104, closed by cards H7a and H7b, `docs/cards/hardening-2-account-cert.md`). Account rows made before H7a (development and staging only; there were no users) have no certificate and are never wrapped for; there is no migration. Envelopes whose *signer* is an account row (the account key during recovery) are not yet accepted by the app's open path, which checks signers by device certificate; M28b decides whether it needs them.

**Trust on first use [R1].** A device keeps a list of the account signing keys it has seen for each person it shares a group with. It wraps group keys only for devices whose certificate verifies under that person's known account key, and for account rows whose `sign_pub` is that known key and whose account certificate verifies under it; it accepts a group-key envelope only if the signing device's certificate verifies under a known account key of a current member. When a person's account key changes (they removed a lost device, or used their recovery key), co-members see "Sam's security key changed" before their devices wrap anything for the new key. People may compare a short safety code in person; the product does not require it. A key-transparency log, or moving to MLS (RFC 9420) later, would remove this weakness; both are out of scope for v1.

## 7. Request signatures

Required on every request that changes devices, keys, group membership or money (the list is in section 15). Headers:

```
Waypoint-Device:    <device id>  ("new" only on POST /v1/devices)
Waypoint-Timestamp: <Unix ms>
Waypoint-Nonce:     <16 random bytes, base64url, 22 characters>
Waypoint-Signature: <ECDSA P-256 r ‖ s over the input below, base64url>
```

Signed input: `context("request", METHOD, path+query exactly as sent, device id, timestamp, nonce, lowercase hex SHA-256 of the body bytes)`. The SHA-256 of an empty body is used when there is none.

The server (S1A) refuses, with one 401 `unauthorized` "device signature required" for every case:

- a missing or malformed header, or a timestamp more than **5 minutes** from the server clock;
- an unknown device, another user's device, a removed device, a device still waiting for approval (except where the route allows it), or the account key row (except on approve);
- a signature that does not verify against the stored `sign_pub`;
- a nonce already seen for that device. Nonces are stored in D1 (`request_nonces`) only after the signature verifies, until the timestamp leaves the window.

The Clerk session is still required; the signature adds proof that the request came from the Secure Enclave of an approved device. A retry (same `Idempotency-Key`) is signed again with a new nonce and timestamp; the idempotency store then replays the first reply. The device works out its clock offset from the `Date` header of any reply.

## 8. Adding a device

### The first device

The first device of an account makes the account key, certifies itself and the account row, and registers both rows in one call: `POST /v1/devices` with `account: { id, sign_pub, box_pub, cert, self_cert }` (`cert` is this device's certificate, `self_cert` the account certificate). The server accepts this only if the user has no active account key row. The app then asks the person to write down their recovery key (section 13).

### A new device, approved by one the person already has (flow 7)

```
New device N                         Server                               Approving device A
------------                         ------                               ------------------
makes keys; picks nonce nN (32 B)
POST /v1/devices {id, keys, C}  -->  stores N as waiting, C = commitment
   C = SHA-256(context("pair-commit", N.sign_pub, N.box_pub, nN))
                                     push to A ------------------------>  GET /v1/devices/N/pairing (keys, C)
                                                                          picks nonce nA (32 B)
                                <--  stores nA, A's id      <-----------  POST /v1/devices/N/pairing {nA}   (signed by A)
GET /v1/devices/N/pairing  ------->  (A.sign_pub, nA)
POST /v1/devices/N/pairing/reveal {nN} (signed by N)
                                     checks C, stores nN    ------------> GET .../pairing; A checks C itself
code = first 4 bytes of SHA-256(context("pair-code", N.sign_pub, N.box_pub, A.sign_pub, nA, nN)), big-endian, mod 1,000,000
both screens show the code; the person taps "They match" on A
                                <--  POST /v1/devices/N/approve {cert, account_envelope, envelopes} (signed by A)
GET /v1/devices, GET .../keys  -->   N verifies A's signature on every envelope, then syncs
```

Why the server cannot fake it **[R4]**: N commits to its nonce before it sees A's nonce, and A picks its nonce before it sees N's. A server sitting in the middle must fix the key and commitment it shows A before it learns `nA`, and N's `nN` is unknown to it until N has committed; so on each side the code is decided by a value the server cannot choose, and it matches the other screen with probability 10⁻⁶. Each attempt is visible to the person and attempts are limited: at most 3 devices waiting per user, each pairing lives 10 minutes, a wrong reveal ends the pairing. This is the commit-then-reveal "short authenticated string" pattern (Vaudenay 2005; Bluetooth LE numeric comparison). The `u32 mod 10⁶` bias is below 0.03 %.

A must check the commitment itself (the server also checks it, to fail early). N must not reveal `nN` before it has `nA`.

The approve call carries: N's certificate (signed by the account key), the account key wrapped for N (an envelope, purpose 2), and the group keys N should have (envelopes, purpose 1) for versions that already exist.

### Without another device: the recovery key

N registers as waiting, fetches the recovery blob (`GET /v1/recovery`), the person types the 12 words, N unwraps the account key, opens the account key's group envelopes, and approves itself: `POST /v1/devices/N/approve` signed with the account signing key (`Waypoint-Device` = the account row's id). No pairing is needed on this path; knowing the account key is the proof.

## 9. Envelopes

An envelope is a key wrapped for one device (or account key row) and signed by the device that wrapped it.

```
u8   version            1
u8   purpose            1 = group key (32-byte plaintext), 2 = account key (64-byte plaintext)
65 B enc                HPKE encapsulated key (P-256 uncompressed)
u16  ct length          48 or 80 (plaintext + 16-byte tag), big-endian
ct
u8   signer id length   1..64
     signer id          ASCII, the wrapping device's id (or the account row's id, during recovery)
64 B signature          ECDSA P-256 over: context("envelope-sig") ‖ u16(len info) ‖ info ‖ every byte above
```

- HPKE `info`: `context("group-key", group id, key version, recipient device id)` or `context("account-key", user id, account row id, recipient device id)`. HPKE `aad`: the two header bytes. An envelope therefore cannot be moved to another group, version, account or device: opening it with any other context fails.
- The server only parses envelopes (shape, purpose, signer id equals the signing device of the request). Recipients verify the signature and the signer's certificate (section 6).

## 10. Group keys and rotation

- **Making a group** (PR 27) creates `groups.key_version = 1`. The creator's device then makes a key and posts the first set of envelopes for version 1 (S2).
- **The first set of envelopes for a version decides the key.** `POST /v1/groups/:id/keys` for a version with no envelopes yet must be for the current version and must cover exactly every *target*: every approved, not removed device and the active account row of every current member. All rows go in one D1 batch of plain inserts. If two devices rotate at the same time, both sets cover the same targets, so the second batch hits the primary key and fails as a whole (409); its device fetches the winner's key.
- **Adding later** (a new member, a newly approved device, older versions for history, envelopes for a new account key row) is the same endpoint with envelopes for devices that do not have one yet. Only devices of current members can receive envelopes. An add may name only the caller's own devices and account row, unless the caller is an owner of the group (owners invite, so they wrap for new members); otherwise it is refused with 409. A slot, once filled, cannot be replaced, so without this any member could take another member's new device's slot with a bad key (card H2).
- **Removing a member** (PR 27, `DELETE /v1/groups/:id/members/:user`) or **removing a device** (S1D) increments `groups.key_version` in the same D1 batch as the removal. Until a new key exists nobody can write (devices do not have it, and sync refuses old versions, see section 15). The device that removed the member makes the new key right away; if it does not, any member's device that sees a current version with no envelope for it does, after a random 0 to 30 s delay.
- **History for new members** is the inviter's device's choice: it wraps the versions from the membership's `history_from` onward. The server does not enforce `history_from` cryptographically **[R12]**.
- **Limits:** with random 96-bit nonces, at most 2³² encryptions per key version (NIST SP 800-38D). A group would need about 100,000 changes a day for over 100 years to get there, so v1 does not count them **[R7]**.

## 11. Locked content

```
u8   version       1
u32  key version   big-endian (0 for link data)
12 B nonce         random
ciphertext ‖ 16-byte tag      AES-256-GCM
AAD = the 17 header bytes ‖ context(...) below
```

| Object | Where | Key | AAD context |
|---|---|---|---|
| A change | room `changes.locked_bytes` | group key of that version | `context("change", group id, device id, kind)` |
| A snapshot | R2 `groups/{group}/snap/{seq}` | group key | `context("snapshot", group id, seq)` |
| Media (audio, photo) | R2 `groups/{group}/media/{blob}` | group key | `context("blob", group id, blob id)` |
| The group's name | D1 `groups.name_locked` | group key | `context("group-name", group id)` |
| Shared-link data | R2 `links/{link}/data` | link key | `context("link", link id)` |

The device id and kind in a change's AAD are also stored in clear by the room, so the server cannot present a change as written by another device or as another kind. **Not protected [R8]:** the server can drop, delay, reorder or replay whole changes; devices de-duplicate by a change id inside the plaintext, but there is no signed log. Media are encrypted in one piece (up to 200 MB, memory permitting); a chunked format can be version 2 of this layout **[R7]**.

## 12. Removing a device

`DELETE /v1/devices/:id`, signed by another approved device of the same user (or by the device itself).

- A device still waiting for approval is just marked removed.
- An approved device held the account key and the group keys, so in one D1 batch the server: marks it removed; increments `key_version` of every group the user is in; marks the old account row removed and inserts the new account row with its account certificate (the calling device made a new account key and sent `account: { id, sign_pub, box_pub, self_cert }`); stores a new certificate and account-key envelope for every remaining approved device (all must be present); and deletes the recovery blob, which wrapped the old account key. The app then asks the person to write down a new recovery key, and posts envelopes of the older group key versions for the new account row.
- If no approved device would remain (the last device removing itself), nothing is rotated; the recovery key still works.
- The batch applies only if, when it runs, the removed device is still live and the user's other approved devices are exactly the ones the request covered; every statement carries that condition, and otherwise nothing changes and the reply is 409 "devices changed, try again". So two devices removing each other at the same time cannot both succeed, which would leave no approved device, an account key nobody holds and no recovery blob (card H2).

## 13. Recovery key

- 16 bytes from the system random generator, shown as 12 words: BIP-39 English, 128-bit entropy plus a 4-bit checksum. The checksum catches most typos; the AES-GCM tag catches the rest.
- `wrap key = HKDF-SHA256(ikm = the 16 bytes, salt = empty, info = context("recovery-key", user id), 32 bytes)`. No slow KDF: the input is 128 uniformly random bits, so stretching adds nothing an attacker would notice **[R6]**.
- Blob (93 bytes, base64url in `recovery.wrapped_account_key`): `u8 version 1 ‖ 12-byte nonce ‖ AES-256-GCM(wrap key, the 64-byte account key, AAD = 0x01 ‖ context("recovery", user id, account row id))`.
- `PUT /v1/recovery` (signed) stores it for the user's current account row; `GET /v1/recovery` returns it to any signed-in session of that user, including a device still waiting for approval **[R6]**. The server checks only the length and version byte.
- The words are never sent anywhere and never stored on the device after setup; the app asks the person to type 3 of them back before it marks the key as verified.

## 14. Sealed task results (S4, flows 2 and 3)

A job records the device that asked for it (`jobs.device_id`, from the request signature). When the job's text result is ready, the workflow calls `sealJobResult`, which:

1. loads that device's `box_pub` (it must still be an approved, not removed device of the job's user);
2. seals the result with HPKE: `info = context("result", job id, device id)`, `aad` = the 2 header bytes; layout `u8 version 1 ‖ u8 purpose 3 ‖ enc (65 B) ‖ ciphertext`; at most 4 MiB of plaintext;
3. writes it to R2 `results/{job}` and sets `jobs.result_key`;
4. overwrites the plaintext buffer with zeros.

The app fetches the result, opens it with its Secure Enclave key, saves it locally and deletes the job. **What sealing protects [R11]:** the 7 days the result sits in R2, against a breach of R2 or anyone reading storage later. It does not protect the result from our server, which wrote it. The workflow step that generates a result must seal it in the same step and return only the R2 key, because Cloudflare Workflows persist step return values. Plaintext is never written to R2, D1, KV, a queue, a log or Analytics Engine.

## 15. Rules other cards must follow

- **Signed routes** (`requireDeviceSignature` from S1A, before the PR 11 idempotency store): every S1 to S3 write; PR 27 `POST /v1/groups`, `POST /v1/groups/:id/invites`, `POST /v1/invites/:token/accept`, `DELETE /v1/groups/:id/members/:user`; PR 14 and 15 task calls; PR 17 `POST /v1/purchases/apple`; PR 20 `POST /v1/jobs`, `DELETE /v1/jobs/:id` and `GET /v1/jobs/:id/result` (the one signed `GET`: it answers only the device the result is sealed to); PR 30 `POST /v1/links` and `DELETE /v1/links/:id`. PR 14, 15 and 17 are merged before S1A; card S1E adds the middleware to their four routes in `createApp`. Because of this, a paid task or a purchase needs a registered, approved device.
- **Session only, not signed** (they change no keys, devices, membership or money): every other `GET` (including S1G's `GET /v1/devices` and PR 21's events stream); PR 23 `PUT /v1/jobs/:id/audio/:n` and `POST /v1/jobs/:id/audio/done` (only the caller's own `retranscribe` job while it is queued; the job was signed and held when it was made); PR 28 `POST /v1/groups/:id/changes` (the change's `device_id` must still be an approved, not removed device of the signed-in user) and the group socket; PR 29 `POST /v1/blobs` and `GET /v1/blobs/:id` (an active membership; uploading needs a paid plan). **No session at all:** `GET /v1/config` and PR 30's `GET /v1/links/:id/data` (rate limited; a passcode link also needs the passcode and a Turnstile token).
- **PR 20** stores `c.get("device").id` in `jobs.device_id` and serves `GET /v1/jobs/:id/result` as `application/octet-stream`, only when the signing device is `jobs.device_id` (404 otherwise). It keeps the text a job sends only encrypted in R2 `tmp/input/{job}`, with the key only in the Workflow's params. **PR 22 to 25** call `sealJobResult` (S4) in the step that makes the result, with the R2 binding `BUCKET` (added by PR 33).
- **PR 27** increments `groups.key_version` in the same D1 batch that ends a membership (removal or leaving), never creates envelopes, and stores `name_locked` as opaque base64url (at most 1,024 characters).
- **PR 28** refuses a change whose `key_version` is not the group's current one (409), so nothing is written with a key a removed member knows.
- **PR 30** stores `passcode_hash = base64url(HMAC-SHA256(LINK_PASSCODE_PEPPER, context("link-passcode", link id, passcode)))` (`linkPasscodeHash` in `packages/crypto`), compares in constant time, and rate-limits attempts with Turnstile. The link key never reaches the server: the viewer reads it from `#k=<base64url 32 bytes>`. The viewer page loads no third-party scripts except, for passcode links only, Cloudflare's Turnstile widget (V1; open question for the reviewer, `docs/build-plan.md`) **[R10]**.
- **Everyone:** never log keys, plaintext, ciphertext bodies, envelopes, signatures, nonces or recovery blobs.

### Endpoints added to the API (not yet in architecture section 4)

`GET /v1/devices/:id/pairing`, `POST /v1/devices/:id/pairing`, `POST /v1/devices/:id/pairing/reveal` (S1C); `GET /v1/groups/:id/devices`, `GET /v1/groups/:id/keys` (S2); `GET /v1/recovery` (S3).

## 16. What is not protected (metadata the server sees)

Who has an account and when they sign in; each device's name, platform and public keys; who is in which group and with what role; when keys rotate; the time, size, kind, device and key version of every change; blob sizes; how often a shared link is opened; IP addresses and push tokens; which cloud tasks a person ran, when, how big, at what price and on which route (`activity`); the plain text sent with a cloud task while it runs, and the audio of a second transcript while it runs (flows 1 to 3; the app says so). The app should name devices by model ("iPhone 15"), not by the student's name.

## 17. Items for the outside review

- **[R1]** Trust on first use for co-members' account keys; the server controls membership lists and device lists.
- **[R2]** P-256 everywhere, because of the Secure Enclave.
- **[R3]** `@hpke/core` as the HPKE implementation on the server (unaudited as far as we know); fallback plan.
- **[R4]** The pairing protocol and the 6-digit code: commitment, ordering, attempt limits, what each side must check.
- **[R5]** The account key is a software key held by every approved device; rotation on device removal; the new recovery key that follows.
- **[R6]** Recovery: HKDF without stretching over 128-bit entropy; the blob is served to any signed-in session of the user.
- **[R7]** AES-GCM with random nonces directly under the group key (2³² limit, no per-message keys); single-piece media.
- **[R8]** No protection against dropped, reordered or replayed changes.
- **[R9]** Request signatures: what is covered (not the `Idempotency-Key` or other headers), the 5-minute window, nonces in D1, the `"new"` device id at registration.
- **[R10]** Shared links: key in the URL fragment; the passcode is server-side access control only, not part of the key.
- **[R11]** Sealed results protect data at rest only; Workflows persistence.
- **[R12]** First-set-wins rotation; history for new members decided by clients.
- **[R13]** A removed device's Clerk session is not revoked by the server (needs a session id per device and a Clerk API call).
- **[R14]** Threat model completeness for a K-12 audience: shared family iPads, parents helping, lost phones, students who never write the recovery key down.
- **[R15]** The account certificate (section 6): it binds the account row's `box_pub` to its `sign_pub`, so a known account key cannot be paired with a server-chosen encryption key. It does not help the first time a person is seen (R1). Is signing over user id, row id and both public keys, under its own context label, the right binding? Should the app also refuse to *record* a first-seen account key whose certificate does not verify?

## 18. Test vectors

Published in `packages/crypto/test/vectors/` (card S0A, S0B), for this server code now and the iOS module later:

| File | Source | What it checks |
|---|---|---|
| `rfc9180-p256-sha256-aes256gcm-base.json` | RFC 9180 test vectors (cfrg/draft-irtf-cfrg-hpke, commit `5f503c56`, the entry with `mode 0, kem_id 16, kdf_id 1, aead_id 2`, first encryption) | HPKE seal (with the vector's ephemeral key) and open |
| `wycheproof-ecdsa-secp256r1-sha256-p1363.json` | C2SP/wycheproof commit `878e5366`, `testvectors_v1/ecdsa_secp256r1_sha256_p1363_test.json`, SHA-256 `c60de693930e386c3a5472d08081623ef8504decc54b38ac01ec6b2a2575c986` | 262 ECDSA verify cases: every `valid` passes, every `invalid` fails |
| `waypoint-v1.json` | Made with the reference code, re-derived independently (section 3) | Every Waypoint format: context, request input and a valid signature, pairing commitment and code, device certificate, account certificate (input bytes and a valid signature; added by H7a, its input and signature re-checked on `node:crypto`), both envelope purposes (exact bytes with fixed `ikmE`, signature, opening), sealed result, recovery wrap key and blob, locked content, link passcode |

The iOS side also checks the BIP-39 English vectors from trezor/python-mnemonic (`vectors.json`, commit `b57a5ad7`; entropy ↔ words only, not the seed) and the word list's SHA-256.

## 19. iOS crypto module: what to build

For the mobile card writer. Minimum **iOS 17** (CryptoKit HPKE). The module is Swift and ships through the App Store, never over the air.

1. **Keys.** Make and load the device signing key (`SecureEnclave.P256.Signing.PrivateKey`) and encryption key (`SecureEnclave.P256.KeyAgreement.PrivateKey`), access `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` with `.privateKeyUsage`; keep their `dataRepresentation` in the Keychain. Store the account key (64 bytes) and group keys (32 bytes per group and version) as Keychain items with the same accessibility. Software keys only in Simulator and test builds.
2. **Encodings.** Strict base64url, `context()`, SEC1 public keys (`x963Representation`), signatures as `rawRepresentation`.
3. **Request signing** with the headers in section 7; a clock offset from the `Date` header; a new nonce on every send, including retries.
4. **Pairing**: commitment, nonce order (never reveal before receiving the approver's nonce), check the commitment on the approving side, the 6-digit code, the screens for both sides.
5. **Certificates**: sign for new devices with the account key, and the account row's own account certificate whenever an account key is made; verify co-members' devices and account rows (both the known `sign_pub` and the account certificate) before wrapping; the trust-on-first-use store and the "security key changed" notice.
6. **Envelopes**: make, parse, verify (signature and signer's certificate), open, for both purposes. HPKE with `HPKE.Sender(recipientKey:ciphersuite:info:)` and `HPKE.Recipient(privateKey:ciphersuite:info:encapsulatedKey:)`, one message per context.
7. **Group keys**: the first-set and add rules of section 10, the random delay, refetch on 409.
8. **Locked content**: lock and unlock with the AAD contexts of section 11.
9. **Sealed results**: open `results/{job}` with the device key.
10. **Recovery**: BIP-39 words ↔ 16 bytes with the checksum, the word list checked by SHA-256, the HKDF wrap key, the blob, the "type 3 words back" check, the new-recovery-key prompt after an account key change.
11. **Device removal**: new account key and its account certificate, new certificates and account-key envelopes for every remaining device, then envelopes of old group versions for the new account row.

It must pass: every case in `waypoint-v1.json` (exact bytes for everything deterministic; open the envelopes and sealed result with the given private keys; verify the given signatures; CryptoKit cannot set HPKE's ephemeral key, so iOS checks HPKE by opening, not by sealing to the same bytes); the RFC 9180 vector (open with `skRm`, check `pkRm`); all Wycheproof `valid`/`invalid` cases with `P256.Signing.PublicKey.isValidSignature`; the Trezor BIP-39 English vectors for 16-byte entropy; and a round trip with the server's TypeScript code in CI once the iOS build machine exists.
