# Mobile cards: M27b, stages 3 and 4, and the shared-link viewer (V1)

This file holds the full cards for:

- **M27b**, devices and the recovery key, pulled forward to come right after M27a (open question 46 in `docs/build-plan.md`: a lost first iPhone otherwise stays "waiting" for ever);
- the **jobs** cards M34 (shared job plumbing), M18 (second transcript) and M19 (research);
- **stage 3**: M22a (Kokoro spike), M22b (voices), M23 (audio overview), M24a–b (video overview), M25a–b (practice, diagrams, mini apps);
- **stage 4**: M3c, M28a–b (groups and keys), M29a–b (sync), M30a–b (sharing and shared links), M2a (Zephyr spike), and short outlines of M2b, M31, M32 and M35 (system targets);
- **V1**, the shared-link web viewer served by the API Worker.

Written 19 Nov 2026 against `main` at `fc57ab8`. It continues `docs/cards/mobile.md` (section 1: versions, the monorepo, tests, commands, "Rules for every mobile card") and `docs/cards/mobile-stage2.md` (section 1: "What stage 2 adds to the rules"). Both apply to every card here, word for word. The spec is `docs/architecture.md`; the crypto design is `docs/security.md`.

**What exists already.** Merged server routes used here: S1B–S1G, S2, S3, S4, PR 20–25 (jobs, events, audio upload, the three Workflows), PR 27–30 (groups, invites, members, sync and its socket, blobs, links), H1–H3b. Merged app code used here: M3 (`packages/api-client`), M13, M26a/M26b (`waypoint-keys`), M27a (registration), M14, M17, M20 (push), H4a–H6. **Not merged yet:** M15, M16 and M21 (their cards are in `docs/cards/mobile-stage2.md`). Cards here that need them say so in "After".

**Numbering.** Stage 2's outline named Sync M28, Share M29 and System targets M30. The owner's numbering for these cards is: **M28** groups and keys, **M29** sync, **M30** sharing and shared links, **M35** system targets. M33 stays "Questions for later" (not in this file). New: **M3b** and **M3c** (API client additions), **M34** (cloud jobs). A card split into sittings gets a letter (M27b-A, M27b-B, …).

**Prototypes.** Every block marked "exactly" that is TypeScript or Swift `Core` was run here before it was written down: the API client additions (M3b) with their tests, the M27b-A Swift (`swift test`, plus `swiftc -typecheck` of `AccountOps.swift` with `IdentityStore.swift` on macOS), the device-list and recovery logic (M27b), the jobs table and second-transcript logic (M34, M18) on `node:sqlite`, the group-key `Core` (M28a), and the V1 viewer (bundle, tests, and `wrangler deploy --dry-run` with the `assets` block). The prototypes were then deleted. Swift outside `Core/` and screens are checked only on the device.

---

## 0. Cards in this file

| Card | Title | After | Sittings | Needs Xcode for |
|---|---|---|---|---|
| M27b-A | Native: recovery words, account key moves, pairing (`waypoint-keys`) | M27a | 1 | device check |
| M3b | API client: devices, recovery, jobs, audio upload, byte replies | M3 | 1 | — |
| M27b-B | Recovery key: write it down, check it, recover a new iPhone | M27b-A, M3b | 1 | device check |
| M27b-C | Devices: approve with the 6-digit code, remove a device, new account key, sign-out cleanup | M27b-B, M20 | 1 | device check |
| M34 | Cloud jobs: start, follow, open the sealed result, delete; the jobs list; the quote box | M3b, M15, M20 | 1 | device check |
| M18 | Second transcript: upload the parts, show changed words | M34 | 1 | device check |
| M19 | Research the web: question, depth, result, sources (no remote images) | M34; M16 for the Explain entry | 1 | device check |
| M22a | **Spike** (time-boxed): Kokoro-82M on the iPhone with an English phonemizer | Xcode, a device | 2 days | everything |
| M22b | Native `waypoint-voices`: render a two-voice script to a file (system voices; Kokoro if M22a says go) | M22a | 1 | device check |
| M25a | Practice sets, and the `made` table | M34 | 1 | device check |
| M23 | Audio overview: job, render, player | M34, M22b, M25a (migration order) | 1 | device check |
| M24a | Video overview, part A: slide timeline and the native renderer | M23 | 1 | device check |
| M24b | Video overview, part B: job, assembly, player | M24a | 1 | device check |
| M25b | Native `waypoint-sandbox`: diagrams and mini apps in a locked web view (**hard gate**) | M25a | 1 | gate and device check |
| M3c | API client: groups, keys, sync, blobs, links | M3b | 1 | — |
| M28a | Native: group keys in the Keychain, wrap and open with trust on first use, locked content and files | M27b-A | 1 | device check |
| M28b | Groups and keys: TOFU list, create, invite, accept, key distribution and rotation | M28a, M3c, M27b-C, M23 (migration order) | 1 | device check |
| M29a | Sync, part A: change format, outbox, apply (core) | M28b | 1 | — |
| M29b | Sync, part B: send, pull after `seq`, the socket, sync pushes, media blobs | M29a | 1 | device check |
| M30a | Share bundle, part A: shared groups, invites, members, leaving | M29b | 1 | device check |
| V1 | Shared-link web viewer (`apps/viewer`, served by the API Worker) | PR 30 (merged) | 1 | — |
| M30b | Share bundle, part B: shared links, move a note into a group, key history | M30a, V1 | 1 | device check |
| M2a | **Spike** (time-boxed): Module Federation and Zephyr on SDK 58's Metro | Xcode | 2 days | everything |
| M2b, M31, M32, M35 | Outlines only (section 7) | — | — | — |

Merge order: M27b-A, M3b, M27b-B, M27b-C, then (after M15, M16 and M20 from stage 2) M34, M18, M19, M25a, M23, M24a, M24b, M25b, then M3c, M28a, M28b, M29a, M29b, M30a, V1, M30b. M22a and M2a are spikes: their branches are not merged. V1 touches only the server and `apps/viewer`, so it can be built at any time. M3c and M28a can be built as soon as their "After" cards are merged.

**Device database migrations** (`apps/mobile/src/core/db/schema.ts`, version numbers fixed here; merge in number order):

| Version | Card | Tables |
|---|---|---|
| 1 | M4 (merged) | the stage 1 tables |
| 2 | M15 (stage 2, not merged) | `explanations`, `terms`, `sent_log` |
| 3 | M34 | `jobs` |
| 4 | M19 | `research` |
| 5 | M25a | `made` |
| 6 | M23 | `overviews` (also holds video overviews, M24) |
| 7 | M28b | `groups`, `key_versions`, `known_accounts`, `trusted_signers` |
| 8 | M29a | `space_groups`, `outbox`, `sync_state`, `row_versions` |
| 9 | M30b | `links` |

Each migration card changes the first test in `test/migrate.test.ts` to its own version ("a new database ends at version N"), and changes nothing else there.

---

## 1. What these cards add to the rules

On top of `AGENTS.md`, "Rules for every mobile card" (`docs/cards/mobile.md`) and "What stage 2 adds to the rules" (`docs/cards/mobile-stage2.md`):

1. **Folders.** New feature folders: `src/features/jobs/`, `src/features/research/`, `src/features/overviews/`, `src/features/made/`, `src/features/share/`. Device and recovery screens go in `src/features/settings/` (they are Settings rows) and, for the new iPhone's side, `src/shell/`. New core folders: `src/core/jobs/`, `src/core/research/`, `src/core/overviews/`, `src/core/made/`, `src/core/groups/`, `src/core/sync/`, `src/core/share/`. Shared presentational components go in `src/ui/`. A feature never imports another feature.
2. **What leaves the phone**, added to stage 2's list: the second transcript's audio (M18; the sheet says so first); a research question and, only if the person turns it on, the session's text (M19); a session's text for an overview, slides, diagram, practice set or mini app (M23–M25). Each job's request body (for `retranscribe`: the minutes and the total audio bytes) is written to `sent_log` **before** it is sent, keyed by its Idempotency-Key (stage 2 rule 3, M15's `logSent`). Stage 4 sends only locked bytes (AES-256-GCM under a group key or link key), public keys, certificates, envelopes and ids.
3. **Keys never reach JavaScript.** Account keys, group keys and recovery entropy stay in `waypoint-keys` (Keychain). JavaScript sees public keys, certificates, envelopes, signatures, locked bytes and — on the recovery screens only — the 12 words, held in component state and dropped on unmount. A link key is the one exception: it is meant to be shared, in the URL fragment (M30b).
4. **Trust.** Only `waypoint-keys` decides whether an envelope's signer is trusted (`docs/security.md` section 6). The app passes it the lists it keeps (`known_devices` for this person's own devices, `known_accounts` and `trusted_signers` for co-members); it never passes a key it got from the server without that check.
5. **Swift.** New testable logic goes in `ios/Core/` (Foundation, plus CryptoKit in `waypoint-keys` only). New modules: `waypoint-voices` (M22b), `waypoint-video` (M24a), `waypoint-sandbox` (M25b); each adds its `Core` and `Tests` targets to `apps/mobile/modules/Package.swift` only if it has `Core` code.
6. **Remote content.** Nothing a cloud job returns is rendered as HTML outside `waypoint-sandbox`, and no remote image or other remote resource is ever loaded from a job result (hardening notes for M19 and M25).

## 2. Owner setup added by these cards

Also to be copied into "Owner setup" in `docs/build-plan.md` when the cards are merged:

- **Voice pack** (after M22a says go): upload the Kokoro model files as one zip to R2 at `packs/voices/<version>.zip`, serve it from a public URL (an R2 custom domain), and write `config:voice-pack` in KV with `version`, `url`, `sha256` (of the zip) and `size`. Until then `GET /v1/config` keeps the placeholder pack and the app uses Apple's voices.
- **KV flag `mini_app_viewer`** in `config:flags`: leave it `false` until M25b's gate has passed on a real iPhone; set it to `true` then. With it off the app neither offers mini apps nor shows one.
- **Turnstile site key** for V1: `TURNSTILE_SITE_KEY=<site key> npm run build -w @waypoint/viewer` before `wrangler deploy` (the secret key is already a Worker secret from PR 30).
- **Push**: M29b turns on background notifications (`enableBackgroundRemoteNotifications` in the `expo-notifications` plugin, which adds the `remote-notification` background mode). Make a new development build after it merges.
- **Zephyr** (M2a): a Zephyr Cloud account and a CI token (`ZE_CI_TOKEN`) for the spike only.
- **Not needed:** universal links. Invites use the app's own scheme (`waypoint://invite/<token>`, M30a); shared links open in any browser (V1).

---

## 3. Devices and the recovery key (M27b) and the API client additions (M3b)

### M27b-A · Native: recovery words, account key moves, pairing (adds to `waypoint-keys`)

Branch `pr/m27b-a-keys-account`. After M27a (merged). No new dependencies. Files, all under `apps/mobile/modules/waypoint-keys/`:
- `ios/Core/Bytes.swift` (one enum case), `ios/Core/Account.swift` (new), `ios/Core/Bip39English.swift` (new, generated), `ios/Tests/AccountTests.swift` (new);
- `ios/IdentityStore.swift` (two stored fields, two error cases), `ios/AccountOps.swift` (new), `ios/WaypointKeysModule.swift` (the lines below), `src/WaypointKeys.ts` (types and wrappers below).

Why it looks like this (`docs/security.md` sections 6, 8, 12, 13 and 19, items 4, 5, 10 and 11):
- **Recovery words**: 16 random bytes shown as 12 BIP-39 English words (128 bits plus a 4-bit checksum). The word list is checked by its SHA-256 and by Trezor's vectors. The words are made natively and returned once, for the screen; nothing stores them.
- **The account key moves** between devices only inside envelopes (purpose 2): when another device approves this one, when this iPhone recovers with the words, and when a removal makes a new account key. Opening an envelope checks that its signer is one the caller trusts (an id → `sign_pub` map the app passes) and that the 64 bytes inside are the account row's public keys.
- **Pairing**: the new device reveals its nonce only together with the approver's nonce (one native call returns both the nonce and the code, so the order cannot be broken by mistake). The approving device checks the commitment itself before it shows a code (`badCommitment` otherwise).
- **Removal** makes the new account key **pending** until the server accepts the `DELETE` (S1D answers 409 "devices changed, try again" when the device list changed), then keeps it or drops it.

`ios/Core/Bytes.swift`: in `KeysError`, change the line `case badEnvelope, badSealed, badRecovery, badContent` to

```swift
  case badEnvelope, badSealed, badRecovery, badContent, badCommitment
```

`ios/Core/Bip39English.swift`: generated from the official list, never edited by hand. From the repo root:

```sh
curl -sSfL -o /tmp/bip39-english.txt https://raw.githubusercontent.com/bitcoin/bips/master/bip-0039/english.txt
shasum -a 256 /tmp/bip39-english.txt   # must print 2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda
node -e '
const words = require("fs").readFileSync("/tmp/bip39-english.txt", "utf8").trim().split("\n");
let out = "// BIP-39 English word list (github.com/bitcoin/bips, bip-0039/english.txt). Generated; do not edit.\n";
out += "// SHA-256 of the file (the words joined by \"\\n\", plus a final \"\\n\"): 2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda\n";
out += "let bip39English: [String] = [\n";
for (let i = 0; i < words.length; i += 8) out += "  " + words.slice(i, i + 8).map((w) => JSON.stringify(w)).join(", ") + ",\n";
out += "]\n";
require("fs").writeFileSync("apps/mobile/modules/waypoint-keys/ios/Core/Bip39English.swift", out);'
```

The file has 260 lines; its first entries are `"abandon", "ability", "able", "about"` and the test below checks the whole list.

`ios/Core/Account.swift`, exactly:

```swift
import CryptoKit
import Foundation

// The 12 recovery words (docs/security.md section 13): BIP-39 English, 128 bits of entropy plus a 4-bit checksum
// (the first 4 bits of SHA-256 of the entropy). 12 words of 11 bits = 132 bits.
public enum Bip39 {
  public static let wordListSha256 = "2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda"
  static let index: [String: Int] = Dictionary(uniqueKeysWithValues: bip39English.enumerated().map { ($1, $0) })

  public static func words(entropy: Data) throws -> [String] {
    guard entropy.count == 16, bip39English.count == 2048 else { throw KeysError.badRecovery }
    let bits = [UInt8](entropy) + [sha256(entropy)[0] & 0xf0]
    return (0..<12).map { i in
      var value = 0
      for b in 0..<11 {
        let bit = i * 11 + b
        value = value << 1 | Int(bits[bit / 8] >> (7 - UInt8(bit % 8)) & 1)
      }
      return bip39English[value]
    }
  }

  // Lowercase words separated by any whitespace. Refuses a word that is not on the list, a count other than 12,
  // and a wrong checksum (most typos).
  public static func entropy(words text: String) throws -> Data {
    let words = text.lowercased().split(whereSeparator: { $0.isWhitespace }).map(String.init)
    guard words.count == 12 else { throw KeysError.badRecovery }
    var bits = [UInt8](repeating: 0, count: 17)
    for (i, word) in words.enumerated() {
      guard let value = index[word] else { throw KeysError.badRecovery }
      for b in 0..<11 where value >> (10 - b) & 1 == 1 {
        let bit = i * 11 + b
        bits[bit / 8] |= 1 << (7 - UInt8(bit % 8))
      }
    }
    let entropy = Data(bits[0..<16])
    guard bits[16] == sha256(entropy)[0] & 0xf0 else { throw KeysError.badRecovery }
    return entropy
  }
}

// The account key (docs/security.md sections 5, 6 and 13): 64 bytes, the signing scalar then the encryption scalar.
public struct AccountKey {
  public let sign: P256.Signing.PrivateKey
  public let box: P256.KeyAgreement.PrivateKey

  public init() {
    sign = P256.Signing.PrivateKey()
    box = P256.KeyAgreement.PrivateKey()
  }

  public init(raw: Data) throws {
    guard raw.count == 64 else { throw KeysError.badRecovery }
    sign = try P256.Signing.PrivateKey(rawRepresentation: raw.prefix(32))
    box = try P256.KeyAgreement.PrivateKey(rawRepresentation: raw.suffix(32))
  }

  public var raw: Data { sign.rawRepresentation + box.rawRepresentation }
  public var signPub: String { sign.publicKeyText }
  public var boxPub: String { boxKeyText(box.publicKey) }

  // A device's certificate and the account key wrapped for it (an envelope, purpose 2). The envelope is signed by
  // `signer` under `signerId`: the approving device, or the account key itself while recovering (signerId = accountId).
  public func certify(userId: String, accountId: String, deviceId: String, signPub: String, boxPub: String, signerId: String, signer: some SigningKey) throws -> (cert: String, envelope: String) {
    let cert = try DeviceCertificate.sign(sign, userId: userId, deviceId: deviceId, signPub: signPub, boxPub: boxPub)
    let info = try Envelope.accountKeyInfo(userId: userId, accountDeviceId: accountId, deviceId: deviceId)
    let envelope = try Envelope.make(purpose: .accountKey, info: info, recipientBoxPub: try PublicKeys.box(boxPub), key: raw, signerId: signerId, signer: signer)
    return (cert, Base64URL.encode(envelope))
  }

  // Opens the account key wrapped for deviceId. The envelope's signer must be one of `trusted` (id → sign_pub) and its
  // signature must verify; the key inside must be the account row's (signPub, boxPub).
  public static func open<K: HPKEDiffieHellmanPrivateKey>(
    envelope text: String, userId: String, accountId: String, deviceId: String, signPub: String, boxPub: String,
    trusted: [String: String], recipient: K
  ) throws -> AccountKey {
    let parsed = try Envelope.parse(try Base64URL.decode(text))
    guard parsed.purpose == .accountKey, let signerPub = trusted[parsed.signerId] else { throw KeysError.badEnvelope }
    let info = try Envelope.accountKeyInfo(userId: userId, accountDeviceId: accountId, deviceId: deviceId)
    guard Envelope.verify(parsed, info: info, signerSignPub: try PublicKeys.signing(signerPub)) else { throw KeysError.badEnvelope }
    let key = try AccountKey(raw: try Envelope.open(parsed, info: info, recipient: recipient))
    guard key.signPub == signPub, key.boxPub == boxPub else { throw KeysError.badEnvelope }
    return key
  }
}

// Making and using the recovery key (docs/security.md section 13).
public enum RecoveryKey {
  // New words and the blob for PUT /v1/recovery.
  public static func make(account: AccountKey, userId: String, accountId: String, entropy: Data = randomBytes(16)) throws -> (words: [String], blob: String) {
    let wrapKey = try Recovery.wrapKey(entropy: entropy, userId: userId)
    let blob = try Recovery.wrap(accountKey: account.raw, wrapKey: wrapKey, userId: userId, accountDeviceId: accountId)
    return (try Bip39.words(entropy: entropy), Base64URL.encode(blob))
  }

  // The account key from the words and GET /v1/recovery. Wrong words, a damaged blob, or a key that is not the
  // account row's all throw badRecovery.
  public static func open(words: String, blob: String, userId: String, accountId: String, signPub: String, boxPub: String) throws -> AccountKey {
    let wrapKey = try Recovery.wrapKey(entropy: try Bip39.entropy(words: words), userId: userId)
    let key = try AccountKey(raw: try Recovery.unwrap(try Base64URL.decode(blob), wrapKey: wrapKey, userId: userId, accountDeviceId: accountId))
    guard key.signPub == signPub, key.boxPub == boxPub else { throw KeysError.badRecovery }
    return key
  }
}

extension Pairing {
  // The approving device's side: check the new device's commitment against its revealed nonce, then the code.
  public static func approverCode(newSignPub: String, newBoxPub: String, commitment: String, approverSignPub: String, approverNonce: String, newNonce: String) throws -> String {
    guard try Pairing.commitment(signPub: newSignPub, boxPub: newBoxPub, newNonce: newNonce) == commitment else { throw KeysError.badCommitment }
    return try code(newSignPub: newSignPub, newBoxPub: newBoxPub, approverSignPub: approverSignPub, approverNonce: approverNonce, newNonce: newNonce)
  }
}
```

`ios/IdentityStore.swift`: in `StoredIdentity`, after `pairingNonce`, add

```swift
  var pendingAccountId: String? // a new account key made for a device removal, until the server accepts it (M27b)
  var pendingAccountKey: Data?
```

and in `KeysModuleError` change the case list and `code` to (two new cases):

```swift
  case noSecureEnclave, noIdentity, exists, keychain(Int), noAccountKey, noPairing

  var code: String {
    switch self {
    case .noSecureEnclave: return "no_secure_enclave"
    case .noIdentity: return "no_identity"
    case .noAccountKey: return "no_account_key"
    case .noPairing: return "no_pairing"
    case .exists: return "exists"
    case .keychain: return "keychain"
    }
  }
```

Optional fields decode as `nil` from Keychain items written by M26b, so no migration of stored items is needed.

`ios/AccountOps.swift`, exactly (it compiles on macOS with `swiftc -typecheck -target arm64-apple-macos15 Core/*.swift IdentityStore.swift AccountOps.swift`, which is a useful check before Xcode exists):

```swift
import CryptoKit
import Foundation

// M27b: the account key, pairing, the recovery key and device removal (docs/security.md sections 6, 8, 12, 13).
// Thin: the formats are in Core/. Every load-modify-save runs inside KeysOps.lock.
extension KeysOps {
  static func identity(_ userId: String) throws -> StoredIdentity {
    guard let identity = try IdentityStore.load(userId: try checkId(userId)) else { throw KeysModuleError.noIdentity }
    return identity
  }

  static func heldAccount(_ identity: StoredIdentity) throws -> (id: String, key: AccountKey) {
    guard let id = identity.accountId, let raw = identity.accountKey else { throw KeysModuleError.noAccountKey }
    return (id, try AccountKey(raw: raw))
  }

  // Opens an account-key envelope addressed to this device with its encryption key.
  static func openAccount(_ identity: StoredIdentity, envelope: String, userId: String, accountId: String, signPub: String, boxPub: String, trusted: [String: String]) throws -> AccountKey {
    identity.hardware
      ? try AccountKey.open(envelope: envelope, userId: userId, accountId: accountId, deviceId: identity.deviceId, signPub: signPub, boxPub: boxPub, trusted: trusted,
        recipient: try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: identity.box))
      : try AccountKey.open(envelope: envelope, userId: userId, accountId: accountId, deviceId: identity.deviceId, signPub: signPub, boxPub: boxPub, trusted: trusted,
        recipient: try P256.KeyAgreement.PrivateKey(rawRepresentation: identity.box))
  }

  // The account key this device holds (public halves only), or nil.
  static func getAccountKey(userId: String) throws -> [String: Any]? {
    guard let identity = try IdentityStore.load(userId: try checkId(userId)), let id = identity.accountId, let raw = identity.accountKey else { return nil }
    let key = try AccountKey(raw: raw)
    return ["accountId": id, "signPub": key.signPub, "boxPub": key.boxPub]
  }

  // New device: only once the approver's nonce is known, reveal ours and work out the code (docs/security.md section 8).
  static func revealPairing(userId: String, approverSignPub: String, approverNonce: String) throws -> [String: Any] {
    let identity = try identity(userId)
    guard let nonce = identity.pairingNonce else { throw KeysModuleError.noPairing }
    let code = try Pairing.code(
      newSignPub: try IdentityStore.signPub(identity), newBoxPub: try IdentityStore.boxPub(identity), approverSignPub: approverSignPub, approverNonce: approverNonce, newNonce: nonce)
    return ["nonce": nonce, "code": code]
  }

  // Approving device: a certificate for the new device and the account key wrapped for it. asAccount (recovery):
  // signed by the account key under the account row's id instead of by this device.
  static func certifyDevice(userId: String, deviceId: String, signPub: String, boxPub: String, asAccount: Bool) throws -> [String: Any] {
    let identity = try identity(userId)
    let account = try heldAccount(identity)
    let made = asAccount
      ? try account.key.certify(userId: userId, accountId: account.id, deviceId: try checkId(deviceId), signPub: signPub, boxPub: boxPub, signerId: account.id, signer: account.key.sign)
      : try account.key.certify(userId: userId, accountId: account.id, deviceId: try checkId(deviceId), signPub: signPub, boxPub: boxPub, signerId: identity.deviceId, signer: try IdentityStore.signingKey(identity))
    return ["cert": made.cert, "accountEnvelope": made.envelope]
  }

  // A request signed by the account key (Waypoint-Device = the account row's id); only for approving this device during recovery.
  static func signRequestAsAccount(userId: String, method: String, target: String, timestamp: Double, body: String) throws -> [String: Any] {
    let account = try heldAccount(try identity(userId))
    guard let ts = Int64(exactly: timestamp), ts >= 0, ts <= 9_007_199_254_740_991 else { throw KeysError.badInput }
    let signed = try RequestSigning.sign(account.key.sign, method: method, target: target, deviceId: account.id, timestamp: ts, body: Data(body.utf8))
    return ["nonce": signed.nonce, "signature": signed.signature]
  }

  // New recovery words for the account key this device holds. The words go to the screen only; nothing keeps them.
  static func makeRecoveryKey(userId: String) throws -> [String: Any] {
    let account = try heldAccount(try identity(userId))
    let made = try RecoveryKey.make(account: account.key, userId: userId, accountId: account.id)
    return ["accountId": account.id, "words": made.words, "blob": made.blob]
  }

  // A waiting device with no other device: the account key from the words and GET /v1/recovery.
  static func recoverAccountKey(userId: String, words: String, accountId: String, blob: String, signPub: String, boxPub: String) throws {
    lock.lock(); defer { lock.unlock() }
    var identity = try identity(userId)
    let key = try RecoveryKey.open(words: words, blob: blob, userId: userId, accountId: try checkId(accountId), signPub: signPub, boxPub: boxPub)
    identity.accountId = accountId
    identity.accountKey = key.raw
    try IdentityStore.save(identity, userId: userId)
  }

  // After approval, or after another device replaced the account key: open the envelope addressed to this device.
  // trusted: the devices (id → sign_pub) whose signature this device accepts (docs/security.md section 6).
  static func adoptAccountKey(userId: String, accountId: String, signPub: String, boxPub: String, envelope: String, trusted: [String: String]) throws {
    lock.lock(); defer { lock.unlock() }
    var identity = try identity(userId)
    let key = try openAccount(identity, envelope: envelope, userId: userId, accountId: try checkId(accountId), signPub: signPub, boxPub: boxPub, trusted: trusted)
    identity.accountId = accountId
    identity.accountKey = key.raw
    identity.pairingNonce = nil
    try IdentityStore.save(identity, userId: userId)
  }

  // Removing an approved device (docs/security.md section 12): a new account key, kept pending, with a certificate
  // and an account-key envelope (signed by this device) for every device that stays.
  static func rotateAccountKey(userId: String, accountId: String, devices: [[String: String]]) throws -> [String: Any] {
    lock.lock(); defer { lock.unlock() }
    var identity = try identity(userId)
    _ = try heldAccount(identity)
    let key = AccountKey()
    let signer = try IdentityStore.signingKey(identity)
    var out: [[String: String]] = []
    for device in devices {
      guard let id = device["id"], let signPub = device["signPub"], let boxPub = device["boxPub"] else { throw KeysError.badInput }
      let made = try key.certify(userId: userId, accountId: try checkId(accountId), deviceId: try checkId(id), signPub: signPub, boxPub: boxPub, signerId: identity.deviceId, signer: signer)
      out.append(["id": id, "cert": made.cert, "accountEnvelope": made.envelope])
    }
    identity.pendingAccountId = accountId
    identity.pendingAccountKey = key.raw
    try IdentityStore.save(identity, userId: userId)
    return ["account": ["id": accountId, "signPub": key.signPub, "boxPub": key.boxPub], "devices": out]
  }

  // keep: the server accepted the removal, so the pending key becomes the account key. Otherwise it is dropped.
  static func finishAccountRotation(userId: String, accountId: String, keep: Bool) throws {
    lock.lock(); defer { lock.unlock() }
    var identity = try identity(userId)
    guard identity.pendingAccountId == accountId, let pending = identity.pendingAccountKey else {
      if keep { throw KeysModuleError.noAccountKey }
      return
    }
    if keep {
      identity.accountId = accountId
      identity.accountKey = pending
    }
    identity.pendingAccountId = nil
    identity.pendingAccountKey = nil
    try IdentityStore.save(identity, userId: userId)
  }
}
```

`ios/WaypointKeysModule.swift`: after the `openSealedResult` function, add exactly:

```swift
    // M27b: the account key, pairing, the recovery key and device removal (AccountOps.swift).
    Function("getAccountKey") { (userId: String) throws -> [String: Any]? in
      try coded { try KeysOps.getAccountKey(userId: userId) }
    }
    Function("newPairingNonce") { () -> String in
      Pairing.newNonce()
    }
    Function("pairingCode") { (newSignPub: String, newBoxPub: String, commitment: String, approverSignPub: String, approverNonce: String, newNonce: String) throws -> String in
      try coded {
        try Pairing.approverCode(
          newSignPub: newSignPub, newBoxPub: newBoxPub, commitment: commitment, approverSignPub: approverSignPub, approverNonce: approverNonce, newNonce: newNonce)
      }
    }
    Function("verifyCertificate") { (accountSignPub: String, cert: String, userId: String, deviceId: String, signPub: String, boxPub: String) -> Bool in
      DeviceCertificate.verify(accountSignPub: accountSignPub, cert: cert, userId: userId, deviceId: deviceId, signPub: signPub, boxPub: boxPub)
    }
    AsyncFunction("revealPairing") { (userId: String, approverSignPub: String, approverNonce: String) throws -> [String: Any] in
      try coded { try KeysOps.revealPairing(userId: userId, approverSignPub: approverSignPub, approverNonce: approverNonce) }
    }
    AsyncFunction("certifyDevice") { (userId: String, deviceId: String, signPub: String, boxPub: String, asAccount: Bool) throws -> [String: Any] in
      try coded { try KeysOps.certifyDevice(userId: userId, deviceId: deviceId, signPub: signPub, boxPub: boxPub, asAccount: asAccount) }
    }
    AsyncFunction("signRequestAsAccount") { (userId: String, method: String, target: String, timestamp: Double, body: String) throws -> [String: Any] in
      try coded { try KeysOps.signRequestAsAccount(userId: userId, method: method, target: target, timestamp: timestamp, body: body) }
    }
    AsyncFunction("makeRecoveryKey") { (userId: String) throws -> [String: Any] in
      try coded { try KeysOps.makeRecoveryKey(userId: userId) }
    }
    AsyncFunction("recoverAccountKey") { (userId: String, words: String, accountId: String, blob: String, signPub: String, boxPub: String) throws in
      try coded { try KeysOps.recoverAccountKey(userId: userId, words: words, accountId: accountId, blob: blob, signPub: signPub, boxPub: boxPub) }
    }
    AsyncFunction("adoptAccountKey") { (userId: String, accountId: String, signPub: String, boxPub: String, envelope: String, trusted: [String: String]) throws in
      try coded { try KeysOps.adoptAccountKey(userId: userId, accountId: accountId, signPub: signPub, boxPub: boxPub, envelope: envelope, trusted: trusted) }
    }
    AsyncFunction("rotateAccountKey") { (userId: String, accountId: String, devices: [[String: String]]) throws -> [String: Any] in
      try coded { try KeysOps.rotateAccountKey(userId: userId, accountId: accountId, devices: devices) }
    }
    AsyncFunction("finishAccountRotation") { (userId: String, accountId: String, keep: Bool) throws in
      try coded { try KeysOps.finishAccountRotation(userId: userId, accountId: accountId, keep: keep) }
    }
```

`src/WaypointKeys.ts`: after `export type SignedRequest = …;` add

```ts
export type HeldAccountKey = { accountId: string; signPub: string; boxPub: string };
export type Certified = { cert: string; accountEnvelope: string };
export type MadeRecoveryKey = { accountId: string; words: string[]; blob: string };
export type RotatedAccountKey = {
  account: { id: string; signPub: string; boxPub: string };
  devices: { id: string; cert: string; accountEnvelope: string }[];
};
```

add these members to `NativeKeys`:

```ts
  getAccountKey(userId: string): HeldAccountKey | null;
  newPairingNonce(): string;
  pairingCode(newSignPub: string, newBoxPub: string, commitment: string, approverSignPub: string, approverNonce: string, newNonce: string): string;
  verifyCertificate(accountSignPub: string, cert: string, userId: string, deviceId: string, signPub: string, boxPub: string): boolean;
  revealPairing(userId: string, approverSignPub: string, approverNonce: string): Promise<{ nonce: string; code: string }>;
  certifyDevice(userId: string, deviceId: string, signPub: string, boxPub: string, asAccount: boolean): Promise<Certified>;
  signRequestAsAccount(userId: string, method: string, target: string, timestamp: number, body: string): Promise<SignedRequest>;
  makeRecoveryKey(userId: string): Promise<MadeRecoveryKey>;
  recoverAccountKey(userId: string, words: string, accountId: string, blob: string, signPub: string, boxPub: string): Promise<void>;
  adoptAccountKey(userId: string, accountId: string, signPub: string, boxPub: string, envelope: string, trusted: Record<string, string>): Promise<void>;
  rotateAccountKey(userId: string, accountId: string, devices: { id: string; signPub: string; boxPub: string }[]): Promise<RotatedAccountKey>;
  finishAccountRotation(userId: string, accountId: string, keep: boolean): Promise<void>;
```

and at the end of the file:

```ts
// M27b. Errors add the codes "no_account_key", "no_pairing", "badCommitment" (the new device's nonce does not match its
// commitment: do not approve), "badRecovery" (wrong words) and "badEnvelope".
export const getAccountKey = (userId: string): HeldAccountKey | null => native.getAccountKey(userId);
export const newPairingNonce = (): string => native.newPairingNonce();
export const pairingCode = (p: { newSignPub: string; newBoxPub: string; commitment: string; approverSignPub: string; approverNonce: string; newNonce: string }): string =>
  native.pairingCode(p.newSignPub, p.newBoxPub, p.commitment, p.approverSignPub, p.approverNonce, p.newNonce);
export const verifyCertificate = (c: { accountSignPub: string; cert: string; userId: string; deviceId: string; signPub: string; boxPub: string }): boolean =>
  native.verifyCertificate(c.accountSignPub, c.cert, c.userId, c.deviceId, c.signPub, c.boxPub);
export const revealPairing = (userId: string, approverSignPub: string, approverNonce: string): Promise<{ nonce: string; code: string }> =>
  native.revealPairing(userId, approverSignPub, approverNonce);
export const certifyDevice = (userId: string, device: { id: string; signPub: string; boxPub: string }, asAccount: boolean): Promise<Certified> =>
  native.certifyDevice(userId, device.id, device.signPub, device.boxPub, asAccount);
export const signRequestAsAccount = (userId: string, method: string, target: string, timestamp: number, body: string): Promise<SignedRequest> =>
  native.signRequestAsAccount(userId, method, target, timestamp, body);
export const makeRecoveryKey = (userId: string): Promise<MadeRecoveryKey> => native.makeRecoveryKey(userId);
export const recoverAccountKey = (userId: string, words: string, account: { id: string; blob: string; signPub: string; boxPub: string }): Promise<void> =>
  native.recoverAccountKey(userId, words, account.id, account.blob, account.signPub, account.boxPub);
export const adoptAccountKey = (userId: string, account: { id: string; signPub: string; boxPub: string }, envelope: string, trusted: Record<string, string>): Promise<void> =>
  native.adoptAccountKey(userId, account.id, account.signPub, account.boxPub, envelope, trusted);
export const rotateAccountKey = (userId: string, accountId: string, devices: { id: string; signPub: string; boxPub: string }[]): Promise<RotatedAccountKey> =>
  native.rotateAccountKey(userId, accountId, devices);
export const finishAccountRotation = (userId: string, accountId: string, keep: boolean): Promise<void> => native.finishAccountRotation(userId, accountId, keep);
```

`ios/Tests/AccountTests.swift`, exactly (the eight 16-byte English entries of `vectors.json` at trezor/python-mnemonic commit `b57a5ad77a981e743f4167ab2f7927a55c1e82a8`):

```swift
import CryptoKit
import Foundation
import Testing
@testable import KeysCore

// Trezor's BIP-39 English vectors (github.com/trezor/python-mnemonic, vectors.json at b57a5ad7), every 16-byte entry.
private let trezor: [(String, String)] = [
  ("00000000000000000000000000000000", "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"),
  ("7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f", "legal winner thank year wave sausage worth useful legal winner thank yellow"),
  ("80808080808080808080808080808080", "letter advice cage absurd amount doctor acoustic avoid letter advice cage above"),
  ("ffffffffffffffffffffffffffffffff", "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"),
  ("9e885d952ad362caeb4efe34a8e91bd2", "ozone drill grab fiber curtain grace pudding thank cruise elder eight picnic"),
  ("c0ba5a8e914111210f2bd131f3d5e08d", "scheme spot photo card baby mountain device kick cradle pact join borrow"),
  ("23db8160a31d3e0dca3688ed941adbf3", "cat swing flag economy stadium alone churn speed unique patch report train"),
  ("f30f8c1da665478f49b001d94c5fc452", "vessel ladder alter error federal sibling chat ability sun glass valve picture"),
]

@Test func wordListIsTheOfficialFile() {
  #expect(bip39English.count == 2048)
  #expect(sha256(Data((bip39English.joined(separator: "\n") + "\n").utf8)).hex == Bip39.wordListSha256)
}

@Test func trezorVectorsBothWays() throws {
  for (hex, words) in trezor {
    #expect(try Bip39.words(entropy: Data(hex: hex)).joined(separator: " ") == words)
    #expect(try Bip39.entropy(words: words).hex == hex)
  }
}

@Test func wordsAreReadLooselyButCheckedStrictly() throws {
  let (hex, words) = trezor[4]
  #expect(try Bip39.entropy(words: "  " + words.uppercased().replacingOccurrences(of: " ", with: "\n ") + "\n").hex == hex)
  var swapped = words.split(separator: " ").map(String.init)
  swapped.swapAt(0, 1)
  #expect(throws: KeysError.badRecovery) { try Bip39.entropy(words: swapped.joined(separator: " ")) } // checksum
  #expect(throws: KeysError.badRecovery) { try Bip39.entropy(words: words.replacingOccurrences(of: "ozone", with: "ozzone")) } // not a word
  #expect(throws: KeysError.badRecovery) { try Bip39.entropy(words: String(words.dropLast(8))) } // 11 words
  #expect(throws: KeysError.badRecovery) { try Bip39.words(entropy: Data(count: 15)) }
}

@Test func recoveryKeyRoundTrip() throws {
  let account = AccountKey()
  let made = try RecoveryKey.make(account: account, userId: "usr_1", accountId: "acct_1")
  #expect(made.words.count == 12)
  #expect(made.blob.count == 124)
  let opened = try RecoveryKey.open(words: made.words.joined(separator: " "), blob: made.blob, userId: "usr_1", accountId: "acct_1", signPub: account.signPub, boxPub: account.boxPub)
  #expect(opened.raw == account.raw)
  // Another user, another account row, or other public keys: refused.
  #expect(throws: KeysError.badRecovery) { try RecoveryKey.open(words: made.words.joined(separator: " "), blob: made.blob, userId: "usr_2", accountId: "acct_1", signPub: account.signPub, boxPub: account.boxPub) }
  #expect(throws: KeysError.badRecovery) { try RecoveryKey.open(words: made.words.joined(separator: " "), blob: made.blob, userId: "usr_1", accountId: "acct_2", signPub: account.signPub, boxPub: account.boxPub) }
  let other = AccountKey()
  #expect(throws: KeysError.badRecovery) { try RecoveryKey.open(words: made.words.joined(separator: " "), blob: made.blob, userId: "usr_1", accountId: "acct_1", signPub: other.signPub, boxPub: account.boxPub) }
}

@Test func recoveryBlobMatchesTheVectorFormat() throws {
  // Fixed entropy gives fixed words; the blob opens with the same words (its nonce is random).
  let account = try AccountKey(raw: Data(repeating: 7, count: 32) + Data(repeating: 9, count: 32))
  let made = try RecoveryKey.make(account: account, userId: "usr_1", accountId: "acct_1", entropy: try Data(hex: trezor[0].0))
  #expect(made.words.joined(separator: " ") == trezor[0].1)
  #expect(try Base64URL.decode(made.blob).first == 1)
}

@Test func certifyAndOpenTheAccountEnvelope() throws {
  let account = AccountKey()
  let approver = P256.Signing.PrivateKey()
  let newSign = P256.Signing.PrivateKey()
  let newBox = P256.KeyAgreement.PrivateKey()
  let made = try account.certify(userId: "usr_1", accountId: "acct_1", deviceId: "dev_new", signPub: newSign.publicKeyText, boxPub: boxKeyText(newBox.publicKey), signerId: "dev_old", signer: approver)
  #expect(DeviceCertificate.verify(accountSignPub: account.signPub, cert: made.cert, userId: "usr_1", deviceId: "dev_new", signPub: newSign.publicKeyText, boxPub: boxKeyText(newBox.publicKey)))
  let opened = try AccountKey.open(envelope: made.envelope, userId: "usr_1", accountId: "acct_1", deviceId: "dev_new", signPub: account.signPub, boxPub: account.boxPub, trusted: ["dev_old": approver.publicKeyText], recipient: newBox)
  #expect(opened.raw == account.raw)
  // An untrusted signer, a signer under another key, or another account row: refused.
  #expect(throws: KeysError.badEnvelope) {
    try AccountKey.open(envelope: made.envelope, userId: "usr_1", accountId: "acct_1", deviceId: "dev_new", signPub: account.signPub, boxPub: account.boxPub, trusted: [:], recipient: newBox)
  }
  #expect(throws: KeysError.badEnvelope) {
    try AccountKey.open(envelope: made.envelope, userId: "usr_1", accountId: "acct_1", deviceId: "dev_new", signPub: account.signPub, boxPub: account.boxPub, trusted: ["dev_old": newSign.publicKeyText], recipient: newBox)
  }
  #expect(throws: KeysError.self) {
    try AccountKey.open(envelope: made.envelope, userId: "usr_1", accountId: "acct_2", deviceId: "dev_new", signPub: account.signPub, boxPub: account.boxPub, trusted: ["dev_old": approver.publicKeyText], recipient: newBox)
  }
  // The account key itself as signer (recovery).
  let selfMade = try account.certify(userId: "usr_1", accountId: "acct_1", deviceId: "dev_new", signPub: newSign.publicKeyText, boxPub: boxKeyText(newBox.publicKey), signerId: "acct_1", signer: account.sign)
  #expect(try AccountKey.open(envelope: selfMade.envelope, userId: "usr_1", accountId: "acct_1", deviceId: "dev_new", signPub: account.signPub, boxPub: account.boxPub, trusted: ["acct_1": account.signPub], recipient: newBox).raw == account.raw)
}

@Test func approverChecksTheCommitmentBeforeTheCode() throws {
  let sign = P256.Signing.PrivateKey().publicKeyText
  let box = boxKeyText(P256.KeyAgreement.PrivateKey().publicKey)
  let approver = P256.Signing.PrivateKey().publicKeyText
  let nN = Pairing.newNonce()
  let nA = Pairing.newNonce()
  let commitment = try Pairing.commitment(signPub: sign, boxPub: box, newNonce: nN)
  let code = try Pairing.approverCode(newSignPub: sign, newBoxPub: box, commitment: commitment, approverSignPub: approver, approverNonce: nA, newNonce: nN)
  #expect(code == (try Pairing.code(newSignPub: sign, newBoxPub: box, approverSignPub: approver, approverNonce: nA, newNonce: nN)))
  #expect(throws: KeysError.badCommitment) {
    try Pairing.approverCode(newSignPub: sign, newBoxPub: box, commitment: commitment, approverSignPub: approver, approverNonce: nA, newNonce: Pairing.newNonce())
  }
}
```

Checks without Xcode: `npm run test:swift -w @waypoint/mobile` (46 tests: the 39 already there and these 7), the `swiftc -typecheck` line above from `apps/mobile/modules/waypoint-keys/ios`, root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.

Device check (run once Xcode is installed; a scratch button in `src/app/dev/` is fine and is removed before merging):
1. `makeRecoveryKey(user)` on an approved iPhone returns 12 words and a 124-character blob; calling `recoverAccountKey` with those words and the account row's keys succeeds; with one word changed it throws `badRecovery`.
2. `getAccountKey(user)` returns the account row's `sign_pub`/`box_pub` from `GET /v1/devices`.
3. `rotateAccountKey` then `finishAccountRotation(…, false)` leaves `getAccountKey` unchanged; with `true` it returns the new key.
4. `[[String: String]]` and `[String: String]` arguments arrive in Swift (the rotate and adopt calls do not throw `badInput` with good input).

Not in this PR: any screen or API call (M27b-B, M27b-C); group keys (M28a).

---

### M3b · API client: devices, recovery, jobs, audio upload, byte replies

Branch `pr/m3b-client-devices-jobs`. After M3 and H5c (merged). No new dependencies. Files: `packages/api-client/src/client.ts`, `packages/api-client/test/client.test.ts` (one helper's type only), `packages/api-client/test/devices-jobs.test.ts` (new).

Why it looks like this:
- Every route the M27b and job cards call, typed from `packages/contracts`, so the app never builds a request by hand.
- `DELETE` with a JSON body (S1D reads one), signed. A **raw** body (the second transcript's audio parts) is sent as bytes with its own `Content-Type` and is **never signed** (PR 23's upload routes are session only, and the signer hashes the text body).
- A new signing mode `{ as: signer }` signs under the given signer's own id: a device still waiting (its pairing reveal, which S1C allows with `allowPending`) and the account key approving its own device during recovery (`allowAccount`).
- Byte replies (`GET /v1/jobs/:id/result`, later `GET /v1/blobs/:id`) come back as `Uint8Array<ArrayBuffer>`; a body cut off part way is a `NetworkError`.
- `FetchInit.body` becomes `string | Uint8Array<ArrayBuffer>`. `ArrayBuffer`, not `ArrayBufferLike`: `expo/fetch`'s `BodyInit` refuses a `Uint8Array` that may sit on a `SharedArrayBuffer`, and `apps/mobile/src/platform/api.ts` must keep type-checking unchanged (checked).
- `POST /v1/jobs` takes the caller's Idempotency-Key: one per thing the person asked for (stage 2 rule 5). It retries on a dropped connection with the same key; the server makes the job id from the key, so a retry finds the same job and never holds twice.

`src/client.ts`, the changes, exactly:

1. Add to the import from `@waypoint/contracts`: `ApproveDeviceRequestSchema`, `AudioChunkResponseSchema`, `AudioDoneResponseSchema`, `AUDIO_CHUNK_CONTENT_TYPE`, `JobResponseSchema`, `JobViewSchema`, `KeyIdSchema`, `PairingViewSchema`, `PutRecoveryRequestSchema`, `RecoveryViewSchema`, `RemoveDeviceRequestSchema`, `RemoveDeviceResponseSchema`, `type AudioChunkResponse`, `type AudioDoneResponse`, `type CreateJobRequest`, `type JobView`, `type PairingView`.
2. Replace `FetchInit`:

```ts
export type FetchInit = { method: string; headers: Record<string, string>; body?: string | Uint8Array<ArrayBuffer>; signal?: AbortSignal };
```

3. Replace `type Signing = …` and the first lines of `CallSpec`:

```ts
// "device": this device once approved. register: POST /v1/devices, signed as "new". as: a given signer under its own
// id (a device still waiting, for its pairing reveal; the account key, for approving itself during recovery).
type Signing = "none" | "device" | { register: DeviceSigner } | { as: DeviceSigner };

type CallSpec = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  target: string; // path and query, starting with "/v1/"
  body?: unknown; // sent as JSON
  raw?: { bytes: Uint8Array<ArrayBuffer>; contentType: string }; // sent as is; never signed (only session routes take raw bodies)
```

(the rest of `CallSpec` is unchanged).

4. Under `const RegisteredSchema = …` add:

```ts
// PUT /v1/recovery's reply (S3 has no contract for it).
const RecoverySavedSchema = z.strictObject({ account_device_id: KeyIdSchema, verified_at: z.number().int().nullable() });
export type RecoverySaved = z.infer<typeof RecoverySavedSchema>;
export type ApproveDeviceRequest = z.infer<typeof ApproveDeviceRequestSchema>;
export type RemoveDeviceRequest = z.infer<typeof RemoveDeviceRequestSchema>;
export type RemoveDeviceResponse = z.infer<typeof RemoveDeviceResponseSchema>;
export type PutRecoveryRequest = z.infer<typeof PutRecoveryRequestSchema>;
export type RecoveryView = z.infer<typeof RecoveryViewSchema>;
```

5. In `attempt`, after `if (body !== undefined) headers["Content-Type"] = "application/json";` add `if (spec.raw !== undefined) headers["Content-Type"] = spec.raw.contentType;`. Replace the two signer lines with:

```ts
      if (spec.raw !== undefined) throw new Error("raw bodies are never signed");
      const signer = signing === "device" ? options.device() : "register" in signing ? signing.register : signing.as;
      if (signer === null) throw new NotRegisteredError();
      const deviceId = signing === "device" || "as" in signing ? signer.id : "new";
```

and after `if (body !== undefined) init.body = body;` add `if (spec.raw !== undefined) init.body = spec.raw.bytes;`.

6. After the `json` function add:

```ts
  // A reply that is bytes (a sealed job result, a locked file). A body cut off part way is a NetworkError.
  async function bytes(spec: CallSpec): Promise<Uint8Array<ArrayBuffer>> {
    const reply = await send(spec);
    try {
      return new Uint8Array(await reply.arrayBuffer());
    } catch {
      throw new NetworkError("reply ended early");
    }
  }

  // GET /v1/jobs/:id/events: one "state" event per change (PR 21). Resolves when the server ends the stream (the job
  // finished, or the stream reached its 10-minute limit); the caller opens a new one if the job is still running.
  async function jobEvents(id: string, onState: (job: JobView) => void, signal?: AbortSignal): Promise<void> {
    const spec: CallSpec = { method: "GET", target: `/v1/jobs/${encodeURIComponent(id)}/events`, retry: false, accept: "text/event-stream" };
    if (signal !== undefined) spec.signal = signal;
    const reply = await send(spec);
    if (reply.body === null) throw new NetworkError("stream ended early");
    let bad = false;
    try {
      await readSse(reply.body, ({ event, data }) => {
        if (event !== "state") return true;
        let value: unknown;
        try {
          value = JSON.parse(data);
        } catch {
          bad = true;
          return false;
        }
        const job = JobViewSchema.safeParse(value);
        if (!job.success) {
          bad = true;
          return false;
        }
        onState(job.data);
        return true;
      });
    } catch (error) {
      if (signal?.aborted === true) throw error;
      throw new NetworkError("stream ended early");
    }
    if (bad) throw new BadReplyError();
  }
```

7. In the returned object, before `clockOffset`, add:

```ts
    // Devices and recovery (M27b; docs/security.md sections 8, 12 and 13).
    pairing: (deviceId: string): Promise<PairingView> =>
      json({ method: "GET", target: `/v1/devices/${encodeURIComponent(deviceId)}/pairing`, retry: true }, PairingViewSchema),
    sendPairingNonce: (deviceId: string, nonce: string): Promise<PairingView> =>
      json({ method: "POST", target: `/v1/devices/${encodeURIComponent(deviceId)}/pairing`, body: { nonce }, signing: "device", retry: true }, PairingViewSchema),
    revealPairing: (deviceId: string, nonce: string, signer: DeviceSigner): Promise<PairingView> =>
      json(
        { method: "POST", target: `/v1/devices/${encodeURIComponent(deviceId)}/pairing/reveal`, body: { nonce }, signing: { as: signer }, retry: true },
        PairingViewSchema,
      ),
    approveDevice: async (deviceId: string, request: ApproveDeviceRequest, signer?: DeviceSigner): Promise<DeviceView> =>
      (
        await json(
          { method: "POST", target: `/v1/devices/${encodeURIComponent(deviceId)}/approve`, body: request, signing: signer === undefined ? "device" : { as: signer }, retry: true },
          RegisteredSchema,
        )
      ).device,
    removeDevice: (deviceId: string, request: RemoveDeviceRequest): Promise<RemoveDeviceResponse> =>
      json({ method: "DELETE", target: `/v1/devices/${encodeURIComponent(deviceId)}`, body: request, signing: "device", retry: true }, RemoveDeviceResponseSchema),
    recovery: (): Promise<RecoveryView> => json({ method: "GET", target: "/v1/recovery", retry: true }, RecoveryViewSchema),
    putRecovery: (request: PutRecoveryRequest): Promise<RecoverySaved> =>
      json({ method: "PUT", target: "/v1/recovery", body: request, signing: "device", retry: true }, RecoverySavedSchema),
    // Jobs (PR 20, 21, 23). key: one per thing the person asked for, kept for "Try again" after Out of credits.
    createJob: async (request: CreateJobRequest, key: string): Promise<JobView> =>
      (await json({ method: "POST", target: "/v1/jobs", body: request, key, signing: "device", retry: true }, JobResponseSchema)).job,
    job: async (id: string): Promise<JobView> => (await json({ method: "GET", target: `/v1/jobs/${encodeURIComponent(id)}`, retry: true }, JobResponseSchema)).job,
    jobEvents,
    jobResult: (id: string): Promise<Uint8Array<ArrayBuffer>> =>
      bytes({ method: "GET", target: `/v1/jobs/${encodeURIComponent(id)}/result`, signing: "device", retry: true, accept: "application/octet-stream" }),
    deleteJob: async (id: string): Promise<JobView> =>
      (await json({ method: "DELETE", target: `/v1/jobs/${encodeURIComponent(id)}`, signing: "device", retry: true }, JobResponseSchema)).job,
    uploadAudio: (id: string, n: number, audio: Uint8Array<ArrayBuffer>): Promise<AudioChunkResponse> =>
      json(
        { method: "PUT", target: `/v1/jobs/${encodeURIComponent(id)}/audio/${n}`, raw: { bytes: audio, contentType: AUDIO_CHUNK_CONTENT_TYPE }, retry: true },
        AudioChunkResponseSchema,
      ),
    audioDone: (id: string, chunks: number): Promise<AudioDoneResponse> =>
      json({ method: "POST", target: `/v1/jobs/${encodeURIComponent(id)}/audio/done`, body: { chunks }, retry: true }, AudioDoneResponseSchema),
```

`test/client.test.ts`: the body type of `verifySent`'s parameter becomes `body?: string | Uint8Array`, and its hash line becomes `bodySha256: await bodySha256(utf8(typeof sent.init.body === "string" ? sent.init.body : "")),`. Nothing else changes.

`test/devices-jobs.test.ts`, exactly:

```ts
import { bodySha256, fromBase64Url, requestSigningInput, utf8, verifyP256 } from "@waypoint/crypto";
import { describe, expect, it } from "vitest";
import { ApiCallError, BadReplyError, NetworkError, NotRegisteredError } from "../src/index.ts";
import { BASE, fakeApi, jsonReply, softwareSigner, sseReply } from "./helpers.ts";

const KEY = "A".repeat(87);
const N32 = "B".repeat(43);
const JOB = {
  id: "job_000000000000000000000001",
  type: "research",
  state: "queued",
  quoted: 15,
  spent: null,
  tier: "standard",
  retention: "standard",
  result_ready: false,
  created_at: 1,
  finished_at: null,
  expires_at: null,
};
const PAIRING = { device_id: "dev_new", commitment: N32, expires_at: 9, approver: null, approver_nonce: null, device_nonce: null };
const DEVICE = { id: "dev_new", kind: "device", name: "iPhone", platform: "ios", sign_pub: KEY, box_pub: KEY, cert: null, account_envelope: null, added_at: 1, approved_at: 2, approved_by: "acct_1" };
const h = (sent: { init: { headers: Record<string, string> } }, name: string): string | undefined => sent.init.headers[name];

async function signedBy(sent: { url: string; init: { method: string; headers: Record<string, string>; body?: string | Uint8Array } }, publicKey: Uint8Array): Promise<boolean> {
  const head = sent.init.headers;
  const input = requestSigningInput({
    method: sent.init.method,
    target: sent.url.slice(BASE.length),
    deviceId: head["Waypoint-Device"] ?? "",
    timestamp: Number(head["Waypoint-Timestamp"]),
    nonce: head["Waypoint-Nonce"] ?? "",
    bodySha256: await bodySha256(utf8(typeof sent.init.body === "string" ? sent.init.body : "")),
  });
  return verifyP256(publicKey, fromBase64Url(head["Waypoint-Signature"] ?? ""), input);
}

describe("devices and recovery", () => {
  it("reveal is signed by the given signer under its own id", async () => {
    const pending = softwareSigner("dev_new");
    const { client, sent } = fakeApi([jsonReply(200, { ...PAIRING, device_nonce: N32 })]);
    await client.revealPairing("dev_new", N32, pending);
    expect(sent[0]?.url).toBe(`${BASE}/v1/devices/dev_new/pairing/reveal`);
    expect(h(sent[0]!, "Waypoint-Device")).toBe("dev_new");
    expect(await signedBy(sent[0]!, pending.publicKey)).toBe(true);
  });
  it("approve signs with this device, or with the account key during recovery", async () => {
    const me = softwareSigner("dev_me");
    const account = softwareSigner("acct_1");
    const { client, sent } = fakeApi([jsonReply(200, { device: DEVICE }), jsonReply(200, { device: DEVICE })], { device: () => me });
    const body = { cert: "C".repeat(86), account_envelope: "E".repeat(200), envelopes: [] };
    await client.approveDevice("dev_new", body);
    await client.approveDevice("dev_new", body, account);
    expect(h(sent[0]!, "Waypoint-Device")).toBe("dev_me");
    expect(h(sent[1]!, "Waypoint-Device")).toBe("acct_1");
    expect(await signedBy(sent[1]!, account.publicKey)).toBe(true);
  });
  it("remove is a signed DELETE with a JSON body; 409 is not retried", async () => {
    const me = softwareSigner("dev_me");
    const { client, sent } = fakeApi([jsonReply(409, { code: "conflict", message: "devices changed, try again", retry_after: null })], { device: () => me });
    await expect(client.removeDevice("dev_old", {})).rejects.toMatchObject({ status: 409, message: "devices changed, try again" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.init.method).toBe("DELETE");
    expect(sent[0]?.init.body).toBe("{}");
    expect(await signedBy(sent[0]!, me.publicKey)).toBe(true);
  });
  it("signed calls need an approved device", async () => {
    const { client, sent } = fakeApi([]);
    await expect(client.sendPairingNonce("dev_new", N32)).rejects.toBeInstanceOf(NotRegisteredError);
    await expect(client.putRecovery({ account_device_id: "acct_1", wrapped_account_key: "R".repeat(124), verified: true })).rejects.toBeInstanceOf(NotRegisteredError);
    expect(sent).toHaveLength(0);
  });
  it("recovery: 404 when there is none", async () => {
    const { client } = fakeApi([jsonReply(404, { code: "not_found", message: "no recovery key", retry_after: null })]);
    await expect(client.recovery()).rejects.toBeInstanceOf(ApiCallError);
  });
});

describe("jobs", () => {
  it("createJob sends the given key and is signed", async () => {
    const me = softwareSigner("dev_me");
    const { client, sent } = fakeApi([jsonReply(201, { job: JOB })], { device: () => me });
    expect(await client.createJob({ type: "research", depth: "quick", question: "why?" }, "key_job_00000001")).toEqual(JOB);
    expect(h(sent[0]!, "Idempotency-Key")).toBe("key_job_00000001");
    expect(await signedBy(sent[0]!, me.publicKey)).toBe(true);
  });
  it("jobResult is a signed GET that returns bytes", async () => {
    const me = softwareSigner("dev_me");
    const { client, sent } = fakeApi([new Response(new Uint8Array([1, 3, 9]), { status: 200 })], { device: () => me });
    expect(await client.jobResult(JOB.id)).toEqual(new Uint8Array([1, 3, 9]));
    expect(h(sent[0]!, "Accept")).toBe("application/octet-stream");
    expect(h(sent[0]!, "Idempotency-Key")).toBeUndefined();
    expect(await signedBy(sent[0]!, me.publicKey)).toBe(true);
  });
  it("uploadAudio sends raw bytes with audio/mp4, unsigned", async () => {
    const { client, sent } = fakeApi([jsonReply(200, { chunk: 2, bytes: 3 })]);
    expect(await client.uploadAudio(JOB.id, 2, new Uint8Array([7, 7, 7]))).toEqual({ chunk: 2, bytes: 3 });
    expect(sent[0]?.init.method).toBe("PUT");
    expect(sent[0]?.url).toBe(`${BASE}/v1/jobs/${JOB.id}/audio/2`);
    expect(sent[0]?.init.body).toEqual(new Uint8Array([7, 7, 7]));
    expect(h(sent[0]!, "Content-Type")).toBe("audio/mp4");
    expect(h(sent[0]!, "Waypoint-Signature")).toBeUndefined();
  });
  it("jobEvents calls onState per state event and skips keep-alives", async () => {
    const seen: string[] = [];
    const { client } = fakeApi([
      sseReply([`event: state\nid: 1\ndata: ${JSON.stringify(JOB)}\n\n`, ": keep-alive\n\n", `event: state\nid: 2\ndata: ${JSON.stringify({ ...JOB, state: "succeeded", result_ready: true })}\n\n`]),
    ]);
    await client.jobEvents(JOB.id, (job) => seen.push(job.state));
    expect(seen).toEqual(["queued", "succeeded"]);
  });
  it("jobEvents: a bad event is BadReplyError", async () => {
    const { client } = fakeApi([sseReply([`event: state\ndata: {"id":1}\n\n`])]);
    await expect(client.jobEvents(JOB.id, () => undefined)).rejects.toBeInstanceOf(BadReplyError);
  });
  it("deleteJob is a signed DELETE with no body", async () => {
    const me = softwareSigner("dev_me");
    const { client, sent } = fakeApi([jsonReply(200, { job: { ...JOB, state: "cancelled" } })], { device: () => me });
    expect((await client.deleteJob(JOB.id)).state).toBe("cancelled");
    expect(sent[0]?.init.body).toBeUndefined();
    expect(h(sent[0]!, "Idempotency-Key")).toBeDefined();
  });
  it("a body cut off part way is NetworkError", async () => {
    const me = softwareSigner("dev_me");
    const broken = new Response(new ReadableStream({ start(c) { c.error(new Error("cut")); } }), { status: 200 });
    const { client } = fakeApi([broken], { device: () => me });
    await expect(client.jobResult(JOB.id)).rejects.toBeInstanceOf(NetworkError);
  });
});
```

Checks: root `npm install`, `npm run typecheck` (it also checks that `apps/mobile/src/platform/api.ts` still accepts the client unchanged), `npm test` (39 api-client tests with the 12 above).

Not in this PR: groups, keys, sync, blobs and links (M3c); any app code.

---
### M27b-B · Recovery key: write it down, check it, and recover a new iPhone with it

Branch `pr/m27b-b-recovery`. After M27b-A and M3b. No new dependencies. Files, all under `apps/mobile/`:
- `src/core/device/recovery.ts` (new), `test/recovery.test.ts` (new);
- `src/platform/recovery.ts` (new);
- `src/features/settings/RecoveryKeyScreen.tsx`, `src/features/settings/RecoveryWordsScreen.tsx`, `src/shell/RecoverScreen.tsx` (new);
- `src/app/recovery-key.tsx`, `src/app/recovery-words.tsx`, `src/app/recover.tsx` (new route files), `src/app/_layout.tsx` (three screen lines), `src/app/(tabs)/_layout.tsx` (one hook call);
- `src/features/settings/SettingsScreen.tsx` (one row), `src/shell/DeviceWaitingScreen.tsx` (one button, one caption).

Why it looks like this (`docs/security.md` section 13; open question 46):
- This is the part of M27b the owner asked to bring forward: without it, a student whose only iPhone is lost or wiped can never approve a new one and cannot spend purchased credits.
- **Making one.** An approved iPhone that holds the account key asks the native module for 12 words and a blob, shows the words, asks for 3 of them back, and only then stores the blob with `PUT /v1/recovery` (`verified: true`). If the person leaves before the check, nothing is stored and the next attempt makes new words. The words live only in the screen's state.
- **When.** Once per launch, an approved iPhone holding the account key asks `GET /v1/recovery`; on 404 it opens the words screen once (it has a "Later" button). That covers the first device right after sign-up and every device after a removal deleted the blob (S1D deletes it when it replaces the account key). Settings › Recovery key shows the state and makes a new key on request; a new key replaces the old one, so the old words stop working.
- **Recovering.** A waiting iPhone (no other device to approve it) offers "Use my recovery key". It fetches `GET /v1/recovery` (allowed for a waiting device, `docs/security.md` R6), the native module opens the account key with the typed words, certifies this iPhone with it, and `POST /v1/devices/:id/approve` is signed **by the account key** (`Waypoint-Device` = the account row's id; M3b's `{ as: signer }`). `envelopes` is `[]`: there are no group keys on the phone yet; M28b adds them here.
- After recovering, the person should remove the lost iPhone (M27b-C). The screen says so.

`src/core/device/recovery.ts`, exactly:

```ts
// The "type 3 words back" check (docs/security.md section 13). Positions are 0-based.
export function pickPositions(random: () => number): number[] {
  const picked = new Set<number>();
  while (picked.size < 3) picked.add(Math.min(11, Math.floor(random() * 12)));
  return [...picked].sort((a, b) => a - b);
}

export function normalizeWord(text: string): string {
  return text.trim().toLowerCase();
}

export function wordsMatch(words: string[], positions: number[], typed: string[]): boolean {
  return positions.length === typed.length && positions.every((p, i) => words[p] !== undefined && words[p] === normalizeWord(typed[i] ?? ""));
}

// What the person typed on the recovery screen, as one line of lowercase words.
export function cleanPhrase(text: string): string {
  return text.toLowerCase().split(/\s+/).filter((w) => w !== "").join(" ");
}

export function wordCount(text: string): number {
  return cleanPhrase(text) === "" ? 0 : cleanPhrase(text).split(" ").length;
}

// GET /v1/recovery, as the screens need it.
export type RecoveryState = "saved" | "unchecked" | "missing" | "unknown";

export function recoveryState(view: { verified_at: number | null } | null, failed: boolean): RecoveryState {
  if (failed) return "unknown";
  if (view === null) return "missing";
  return view.verified_at === null ? "unchecked" : "saved";
}
```

`test/recovery.test.ts`, exactly:

```ts
import { describe, expect, it } from "vitest";
import { cleanPhrase, pickPositions, recoveryState, wordCount, wordsMatch } from "../src/core/device/recovery.ts";

describe("recovery words", () => {
  const words = "a b c d e f g h i j k l".split(" ");
  it("pickPositions gives 3 different sorted positions", () => {
    const seq = [0.99, 0.0, 0.0, 0.5];
    expect(pickPositions(() => seq.shift() ?? 0.2)).toEqual([0, 6, 11]);
  });
  it("wordsMatch ignores case and spaces, and needs every word", () => {
    expect(wordsMatch(words, [0, 5, 11], [" A", "f ", "L"])).toBe(true);
    expect(wordsMatch(words, [0, 5, 11], ["a", "f", "k"])).toBe(false);
    expect(wordsMatch(words, [0, 5, 11], ["a", "f"])).toBe(false);
  });
  it("cleanPhrase and wordCount", () => {
    expect(cleanPhrase("  Zoo\nzoo   WRONG ")).toBe("zoo zoo wrong");
    expect(wordCount(" ")).toBe(0);
    expect(wordCount("a b\tc")).toBe(3);
  });
  it("recoveryState", () => {
    expect(recoveryState({ verified_at: 5 }, false)).toBe("saved");
    expect(recoveryState({ verified_at: null }, false)).toBe("unchecked");
    expect(recoveryState(null, false)).toBe("missing");
    expect(recoveryState(null, true)).toBe("unknown");
  });
});
```

`src/platform/recovery.ts`, exactly (it imports `./device.ts`; `device.ts` does not import it back):

```ts
import { useEffect, useRef } from "react";
import { router } from "expo-router";
import { ApiCallError, NetworkError } from "@waypoint/api-client";
import {
  certifyDevice,
  getAccountKey,
  getDeviceKeys,
  makeRecoveryKey,
  recoverAccountKey,
  signRequestAsAccount,
  type MadeRecoveryKey,
} from "../../modules/waypoint-keys/index.ts";
import { cleanPhrase, recoveryState, type RecoveryState } from "../core/device/recovery.ts";
import { api } from "./api.ts";
import { currentUserId, refreshDeviceNow, useDeviceStatus } from "./device.ts";

const notFound = (error: unknown): boolean => error instanceof ApiCallError && error.status === 404;

export async function loadRecoveryState(): Promise<RecoveryState> {
  try {
    return recoveryState(await api.recovery(), false);
  } catch (error) {
    return recoveryState(null, !notFound(error));
  }
}

// True when this iPhone can make a recovery key: it is signed in and holds the account key.
export function canMakeRecoveryKey(): boolean {
  const user = currentUserId();
  return user !== null && getAccountKey(user) !== null;
}

export async function newRecoveryKey(): Promise<MadeRecoveryKey> {
  const user = currentUserId();
  if (user === null) throw new Error("signed out");
  return makeRecoveryKey(user);
}

// Stores the blob once the person typed 3 words back. "changed": the account key was replaced meanwhile (another
// device removed one): make new words.
export async function saveRecoveryKey(made: MadeRecoveryKey): Promise<"saved" | "changed" | "offline" | "failed"> {
  try {
    await api.putRecovery({ account_device_id: made.accountId, wrapped_account_key: made.blob, verified: true });
    return "saved";
  } catch (error) {
    if (error instanceof ApiCallError && error.status === 409) {
      void refreshDeviceNow();
      return "changed";
    }
    return error instanceof NetworkError ? "offline" : "failed";
  }
}

export type RecoverResult = "approved" | "wrong_words" | "no_recovery" | "offline" | "failed";

// A waiting iPhone approves itself with the recovery words (docs/security.md section 8, "Without another device").
export async function recoverWithWords(words: string): Promise<RecoverResult> {
  const user = currentUserId();
  const keys = user === null ? null : getDeviceKeys(user);
  if (user === null || keys === null) return "failed";
  try {
    const found = await api.recovery();
    try {
      await recoverAccountKey(user, cleanPhrase(words), {
        id: found.account_device_id,
        blob: found.wrapped_account_key,
        signPub: found.sign_pub,
        boxPub: found.box_pub,
      });
    } catch {
      return "wrong_words";
    }
    const made = await certifyDevice(user, { id: keys.deviceId, signPub: keys.signPub, boxPub: keys.boxPub }, true);
    const account = {
      id: found.account_device_id,
      sign: (input: { method: string; target: string; timestamp: number; body: string }) =>
        signRequestAsAccount(user, input.method, input.target, input.timestamp, input.body),
    };
    try {
      await api.approveDevice(keys.deviceId, { cert: made.cert, account_envelope: made.accountEnvelope, envelopes: [] }, account);
    } catch (error) {
      // Approved meanwhile by another device: fine, the refresh below shows it.
      if (!(error instanceof ApiCallError && error.status === 409)) throw error;
    }
    await refreshDeviceNow();
    return "approved";
  } catch (error) {
    if (notFound(error)) return "no_recovery";
    return error instanceof NetworkError ? "offline" : "failed";
  }
}

// Once per launch: an approved iPhone holding the account key, with no recovery key on the server, opens the words
// screen (it has "Later"). Called once in (tabs)/_layout.tsx.
export function useRecoveryPrompt(): void {
  const status = useDeviceStatus();
  const asked = useRef(false);
  useEffect(() => {
    if (status !== "approved" || asked.current || !canMakeRecoveryKey()) return;
    asked.current = true;
    void loadRecoveryState().then((state) => {
      if (state === "missing") router.push("/recovery-words");
    });
  }, [status]);
}
```

`src/app/(tabs)/_layout.tsx`: add `useRecoveryPrompt();` after `usePush();`, imported from `../../platform/recovery.ts`.

`src/app/_layout.tsx`: inside the `gate === "app"` group add `<Stack.Screen name="recovery-key" />`, `<Stack.Screen name="recovery-words" options={{ presentation: "modal", gestureEnabled: false }} />`, `<Stack.Screen name="recover" options={{ presentation: "modal" }} />`. Each route file only re-exports its screen.

Screens (copy written for this card; check it against boards A4–A6 and J1–J3):

- **`RecoveryWordsScreen`** (`/recovery-words`), four steps in one screen's state:
  1. *Intro.* Title "Your recovery key". Body "12 words that get you back into Waypoint if you lose this iPhone. Write them on paper and keep it somewhere safe, like with your school things at home." Caption "Waypoint can't see these words and can't send them to you again." Buttons "Show my words" (calls `newRecoveryKey()`; error → caption "Couldn't make a recovery key. Try again.") and "Later" (`router.back()`).
  2. *Words.* Title "Write these down". The 12 words in a two-column numbered grid (`1. word` … `12. word`), large text, `selectable={false}`. Caption "In this order. Anyone with these words can open your notes." Button "I wrote them down" → step 3 with `pickPositions(Math.random)`.
  3. *Check.* Title "Check your words". Three text fields labelled "Word 3", "Word 7", "Word 12" (the picked positions plus one), `autoCapitalize="none"`, `autoCorrect={false}`, `spellCheck={false}`, `textContentType="none"`. Button "Check": `wordsMatch` false → caption "That doesn't match. Look at your paper and try again." and a text button "Show the words again" (back to step 2, same words). True → `saveRecoveryKey(made)`: `saved` → step 4; `offline` → caption "You're offline. Connect and tap Check again."; `changed` → caption "Your account changed on another device. Start again." and back to step 1 with the words dropped; `failed` → caption "Couldn't save. Try again."
  4. *Done.* Title "Recovery key saved". Body "Keep the paper safe. You'll need it only if you lose all your devices." Button "Done" (`router.back()`).
  The words and blob are dropped when the screen unmounts (state only, never `writeDb`, never a log).

- **`RecoveryKeyScreen`** (`/recovery-key`): title "Recovery key", one information row with `loadRecoveryState()`: `saved` "Saved and checked", `unchecked` "Saved, not checked", `missing` "Not set up", `unknown` "Can't check while offline". Body "If you lose all your devices, your recovery key is the only way back into your notes." Button "Make a new recovery key" (opens `/recovery-words`), shown only when `canMakeRecoveryKey()`; otherwise caption "This iPhone can't make a recovery key yet." Under the button, caption "A new key replaces the old one. The old words stop working."

- **`RecoverScreen`** (`/recover`, shown from the waiting screen): title "Use your recovery key". Body "Type your 12 words, with spaces between them." One multiline `TextInput` (`autoCapitalize="none"`, `autoCorrect={false}`, `spellCheck={false}`, `autoComplete="off"`, `textContentType="none"`), caption "`n` of 12 words" from `wordCount`. Button "Recover" enabled at exactly 12 words → `recoverWithWords(text)`: `approved` → title "This iPhone is ready", body "If you lost your other device, remove it in Settings › Devices so it can't open new notes." and "Done"; `wrong_words` → "Those words don't match your recovery key. Check each word and try again."; `no_recovery` → "There's no recovery key for this account. Approve this iPhone from your other device instead."; `offline` → "You're offline. Connect and try again."; `failed` → "Something went wrong. Try again." The text is cleared when the screen closes.

- **`SettingsScreen`**: under ACCOUNT, after "Plans & credits", a `Link` row "Recovery key" → `/recovery-key`.
- **`DeviceWaitingScreen`**: for `waiting`, replace the caption with "No other device? Use your recovery key." and add a `SecondaryButton` "Use my recovery key" (icon `key`) → `router.push("/recover")`, under "Check again".

Checks without Xcode: root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.

Device check (run once Xcode is installed; the API at `main`):
1. Sign up a new account: after "Setting up this iPhone", the words screen opens once. "Later" closes it; relaunching opens it again.
2. Show the words, type two right and one wrong: "That doesn't match". Fix it: "Recovery key saved". `GET /v1/recovery` (read D1) has `verified_at` set. Relaunch: no prompt. Settings › Recovery key says "Saved and checked".
3. "Make a new recovery key", finish it: the old words no longer recover (step 5 with the old words fails with "don't match").
4. Close the words screen at step 2 and reopen: different words; nothing was stored (D1 unchanged).
5. On a second iPhone (or the Simulator) signed in to the same account, "Use my recovery key" with the words: it becomes approved, and a paid Explain works on it (after M15). With one word wrong: "Those words don't match".
6. With the server's `recovery` row deleted: "There's no recovery key for this account."

Not in this PR: approving with the 6-digit code, removing devices, taking a replaced account key (M27b-C); group keys during recovery (M28b).

---

### M27b-C · Devices: approve with the 6-digit code, remove a device, a new account key, sign-out cleanup

Branch `pr/m27b-c-devices`. After M27b-B and M20 (merged). No new dependencies. Files, all under `apps/mobile/`:
- `src/core/device/devices.ts` (new), `test/devices.test.ts` (new); `src/core/push/push.ts`, `test/push.test.ts` (the lines below);
- `src/platform/device.ts` (the changes below), `src/platform/devices.ts` (new), `src/platform/push.ts` (the push payload fix and one action);
- `src/features/settings/DevicesScreen.tsx`, `src/features/settings/ApproveDeviceScreen.tsx` (new), `src/app/devices.tsx`, `src/app/devices/approve.tsx` (new), `src/app/_layout.tsx` (two screen lines), `src/features/settings/SettingsScreen.tsx` (one row), `src/shell/DeviceWaitingScreen.tsx` (the code, the expired state, copy).

Why it looks like this (`docs/security.md` sections 6, 8 and 12; hardening notes for M27b):
- **Approve with the code** (flow 7). The approving iPhone sends its nonce, waits for the reveal, checks the commitment itself (`pairingCode` throws `badCommitment` otherwise) and shows the code; "They match" sends the certificate and the account-key envelope (`envelopes: []` until M28b adds group keys). "They don't match" removes the waiting device. The new iPhone, while its waiting screen is open, polls its pairing, reveals only once the approver's nonce is in (M27b-A's single call), shows the same code, and remembers the approver's id and `sign_pub` (bound into the code the person compared) so it can open the account-key envelope once approved.
- **Restart an expired pairing** (hardening note): a pairing lives 10 minutes and a wrong reveal ends it. Then the waiting screen offers "Start again", which forgets this iPhone's keys and registers again with a new device id and commitment (M27a's `start_over` path). The old row stays "waiting" until someone removes it from the list.
- **Remove a device** (S1D): a waiting device is removed with `{}`. Removing an approved device makes a new account key (pending in the Keychain), with a certificate and an account-key envelope for every approved device that stays. On 409 "devices changed, try again" (H2) the pending key is dropped, the list reloads and the person is asked again. On success the pending key is kept and the recovery key must be made again (the server deleted the blob): M27b-B's prompt opens on the next launch. The last device removing itself sends `{}` (nothing is rotated).
- **Take a replaced account key.** Every refresh of an approved iPhone compares the account row with the key it holds; when the row changed, it opens the envelope on its own row — but only if the envelope's signer is in its `known_devices` list (devices it has seen certified by an account key it held), the pairing approver, or itself (a removal it made whose reply was lost). That list grows on every refresh and never shrinks.
- **Sign-out cleanup** (hardening note): the signer is already cleared on sign-out; in-flight registration is now keyed by Clerk id, so a pass started for one person never sets the signer or status for the next. Approver nonces are kept per user id.
- **Push payloads** (found while writing this card): the server sends `kind` and `ref` at the top level of the APNs payload (`apps/api/src/push/messages.ts`), but `expo-notifications` puts only the payload's `body` key into `content.data` for remote notifications (`NotificationRecords.swift`, `serializedNotificationData`). M20's tap handler therefore never sees `kind`. The fix reads `request.trigger.payload` for push triggers.

`src/core/device/devices.ts`, exactly:

```ts
import type { DeviceView, PairingView } from "@waypoint/contracts";

// Settings keys, per server user id.
export const knownDevicesKey = (userId: string): string => `known_devices:${userId}`;
export const pairingApproverKey = (userId: string): string => `pairing_approver:${userId}`;

// id → sign_pub of devices whose certificate verified under an account key this iPhone held (docs/security.md
// section 6). Only these may hand this iPhone a new account key.
export type Known = Record<string, string>;

export function parseKnown(text: string | null): Known {
  if (text === null) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const out: Known = {};
    for (const [id, pub] of Object.entries(value)) if (typeof pub === "string") out[id] = pub;
    return out;
  } catch {
    return {};
  }
}

// The pairing approver this iPhone compared a code with: { id, signPub }, or null.
export function parseApprover(text: string | null): { id: string; signPub: string } | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return null;
    const { id, signPub } = value as { id?: unknown; signPub?: unknown };
    return typeof id === "string" && typeof signPub === "string" ? { id, signPub } : null;
  } catch {
    return null;
  }
}

export type CertCheck = (c: { accountSignPub: string; cert: string; deviceId: string; signPub: string; boxPub: string }) => boolean;

// Adds every approved device whose certificate verifies under the account key held now. Never removes one.
export function updateKnown(known: Known, devices: DeviceView[], heldSignPub: string, verify: CertCheck): Known {
  const out: Known = { ...known };
  for (const d of devices) {
    if (d.kind !== "device" || d.approved_at === null || d.cert === null) continue;
    if (verify({ accountSignPub: heldSignPub, cert: d.cert, deviceId: d.id, signPub: d.sign_pub, boxPub: d.box_pub })) out[d.id] = d.sign_pub;
  }
  return out;
}

// What this approved iPhone must do about the account key after reading GET /v1/devices.
export type AccountStep =
  | { kind: "none" } // it holds the current one (or is not approved yet)
  | { kind: "adopt"; account: { id: string; signPub: string; boxPub: string }; envelope: string }
  | { kind: "missing" }; // approved, but no account key it can open: it must be removed and added again

export function accountStep(devices: DeviceView[], myId: string, heldAccountId: string | null): AccountStep {
  const account = devices.find((d) => d.kind === "account");
  const mine = devices.find((d) => d.kind === "device" && d.id === myId);
  if (account === undefined || mine === undefined || mine.approved_at === null || heldAccountId === account.id) return { kind: "none" };
  if (mine.account_envelope === null) return { kind: "missing" };
  return { kind: "adopt", account: { id: account.id, signPub: account.sign_pub, boxPub: account.box_pub }, envelope: mine.account_envelope };
}

// The rows of Settings › Devices: this iPhone first, then approved devices, then waiting ones.
export type DeviceRow = { id: string; name: string; mine: boolean; waiting: boolean; addedAt: number };

export function deviceRows(devices: DeviceView[], myId: string | null): DeviceRow[] {
  return devices
    .filter((d) => d.kind === "device")
    .map((d) => ({ id: d.id, name: d.name, mine: d.id === myId, waiting: d.approved_at === null, addedAt: d.added_at }))
    .sort((a, b) => Number(b.mine) - Number(a.mine) || Number(a.waiting) - Number(b.waiting) || a.addedAt - b.addedAt);
}

// DELETE /v1/devices/:id (docs/security.md section 12).
export type RemovalPlan =
  | { kind: "plain" } // a waiting device, or the last approved device removing itself: body {}
  | { kind: "rotate"; remaining: { id: string; signPub: string; boxPub: string }[] }; // a new account key for every device that stays

export function removalPlan(devices: DeviceView[], targetId: string): RemovalPlan | null {
  const target = devices.find((d) => d.kind === "device" && d.id === targetId);
  if (target === undefined) return null;
  if (target.approved_at === null) return { kind: "plain" };
  const remaining = devices
    .filter((d) => d.kind === "device" && d.approved_at !== null && d.id !== targetId)
    .map((d) => ({ id: d.id, signPub: d.sign_pub, boxPub: d.box_pub }));
  return remaining.length === 0 ? { kind: "plain" } : { kind: "rotate", remaining };
}

// Pairing, from the new iPhone's side (docs/security.md section 8). Never reveal before the approver's nonce is in.
export type NewDeviceStep =
  | { kind: "wait_approver" }
  | { kind: "reveal"; approver: { id: string; signPub: string }; approverNonce: string }
  | { kind: "wait_approval" } // revealed: the code shows on both screens
  | { kind: "expired" };

export function newDeviceStep(view: PairingView, now: number): NewDeviceStep {
  if (view.device_nonce !== null) return { kind: "wait_approval" };
  if (view.expires_at <= now) return { kind: "expired" };
  if (view.approver === null || view.approver_nonce === null) return { kind: "wait_approver" };
  return { kind: "reveal", approver: { id: view.approver.id, signPub: view.approver.sign_pub }, approverNonce: view.approver_nonce };
}

// Pairing, from the approving iPhone's side.
export type ApproverStep =
  | { kind: "start" } // nobody has started: send our nonce
  | { kind: "taken" } // another device started it
  | { kind: "wait_reveal" }
  | { kind: "compare"; deviceNonce: string }
  | { kind: "expired" };

export function approverStep(view: PairingView, myId: string, now: number): ApproverStep {
  if (view.expires_at <= now) return { kind: "expired" };
  if (view.approver === null) return { kind: "start" };
  if (view.approver.id !== myId) return { kind: "taken" };
  return view.device_nonce === null ? { kind: "wait_reveal" } : { kind: "compare", deviceNonce: view.device_nonce };
}
```

`test/devices.test.ts`, exactly:

```ts
import type { DeviceView, PairingView } from "@waypoint/contracts";
import { describe, expect, it } from "vitest";
import { accountStep, approverStep, deviceRows, newDeviceStep, parseApprover, parseKnown, removalPlan, updateKnown } from "../src/core/device/devices.ts";

const K = (c: string): string => c.repeat(87);
const N = (c: string): string => c.repeat(43);
function row(over: Partial<DeviceView>): DeviceView {
  return { id: "dev_1", kind: "device", name: "iPhone 15", platform: "ios", sign_pub: K("A"), box_pub: K("B"), cert: "C".repeat(86), account_envelope: null, added_at: 1, approved_at: 1, approved_by: null, ...over };
}
const ACCOUNT = row({ id: "acct_1", kind: "account", name: "Account key", platform: "account", cert: null, sign_pub: K("S"), box_pub: K("X") });
const VIEW: PairingView = { device_id: "dev_new", commitment: N("C"), expires_at: 1000, approver: null, approver_nonce: null, device_nonce: null };

describe("known devices", () => {
  it("parseKnown keeps string entries and survives junk", () => {
    expect(parseKnown(null)).toEqual({});
    expect(parseKnown("not json")).toEqual({});
    expect(parseKnown("[1]")).toEqual({});
    expect(parseKnown('{"a":"x","b":2}')).toEqual({ a: "x" });
  });
  it("parseApprover", () => {
    expect(parseApprover('{"id":"dev_a","signPub":"P"}')).toEqual({ id: "dev_a", signPub: "P" });
    expect(parseApprover('{"id":1}')).toBeNull();
    expect(parseApprover(null)).toBeNull();
  });
  it("updateKnown adds approved devices whose certificate verifies, and never drops one", () => {
    const devices = [ACCOUNT, row({ id: "dev_1" }), row({ id: "dev_2", sign_pub: K("D") }), row({ id: "dev_3", approved_at: null }), row({ id: "dev_4", cert: null })];
    const verify = ({ deviceId }: { deviceId: string }) => deviceId !== "dev_2";
    expect(updateKnown({ old: K("O") }, devices, K("S"), verify)).toEqual({ old: K("O"), dev_1: K("A") });
  });
});

describe("accountStep", () => {
  it("nothing to do when this iPhone holds the current account key, or is not approved", () => {
    expect(accountStep([ACCOUNT, row({})], "dev_1", "acct_1")).toEqual({ kind: "none" });
    expect(accountStep([ACCOUNT, row({ approved_at: null })], "dev_1", null)).toEqual({ kind: "none" });
  });
  it("adopt the envelope on our row when the account row changed", () => {
    expect(accountStep([row({ ...ACCOUNT, id: "acct_2" }), row({ account_envelope: "E" })], "dev_1", "acct_1")).toEqual({
      kind: "adopt",
      account: { id: "acct_2", signPub: K("S"), boxPub: K("X") },
      envelope: "E",
    });
  });
  it("missing when approved without an envelope and without the key", () => {
    expect(accountStep([ACCOUNT, row({})], "dev_1", null)).toEqual({ kind: "missing" });
  });
});

describe("devices list and removal", () => {
  const list = [ACCOUNT, row({ id: "dev_b", added_at: 5 }), row({ id: "dev_w", approved_at: null, added_at: 2 }), row({ id: "dev_1", added_at: 9 })];
  it("this iPhone first, then approved, then waiting", () => {
    expect(deviceRows(list, "dev_1").map((r) => r.id)).toEqual(["dev_1", "dev_b", "dev_w"]);
  });
  it("a waiting device is removed plainly; an approved one rotates for every device that stays", () => {
    expect(removalPlan(list, "dev_w")).toEqual({ kind: "plain" });
    expect(removalPlan(list, "dev_b")).toEqual({ kind: "rotate", remaining: [{ id: "dev_1", signPub: K("A"), boxPub: K("B") }] });
    expect(removalPlan([ACCOUNT, row({})], "dev_1")).toEqual({ kind: "plain" });
    expect(removalPlan(list, "acct_1")).toBeNull();
    expect(removalPlan(list, "nope")).toBeNull();
  });
});

describe("pairing steps", () => {
  it("the new iPhone reveals only after the approver's nonce", () => {
    expect(newDeviceStep(VIEW, 0)).toEqual({ kind: "wait_approver" });
    expect(newDeviceStep({ ...VIEW, approver: { id: "dev_a", sign_pub: K("A") }, approver_nonce: N("A") }, 0)).toEqual({
      kind: "reveal",
      approver: { id: "dev_a", signPub: K("A") },
      approverNonce: N("A"),
    });
    expect(newDeviceStep({ ...VIEW, device_nonce: N("D") }, 0)).toEqual({ kind: "wait_approval" });
    expect(newDeviceStep(VIEW, 1000)).toEqual({ kind: "expired" });
  });
  it("the approver starts, waits, then compares; another approver means taken", () => {
    expect(approverStep(VIEW, "dev_a", 0)).toEqual({ kind: "start" });
    const mine = { ...VIEW, approver: { id: "dev_a", sign_pub: K("A") }, approver_nonce: N("A") };
    expect(approverStep(mine, "dev_a", 0)).toEqual({ kind: "wait_reveal" });
    expect(approverStep({ ...mine, device_nonce: N("D") }, "dev_a", 0)).toEqual({ kind: "compare", deviceNonce: N("D") });
    expect(approverStep(mine, "dev_b", 0)).toEqual({ kind: "taken" });
    expect(approverStep(mine, "dev_a", 1000)).toEqual({ kind: "expired" });
  });
});
```

`src/core/push/push.ts`: `PushAction` gains `| { kind: "approve_device"; deviceId: string }`, and `actionForPush` gains, before the final return:

```ts
  if (data.kind === "device_request" && typeof data.ref === "string") return { kind: "approve_device", deviceId: data.ref };
```

(and its comment loses "device_request opens approval in M27b"). `test/push.test.ts` "taps" adds `expect(actionForPush({ kind: "device_request", ref: "dev_new" })).toEqual({ kind: "approve_device", deviceId: "dev_new" });` and `expect(actionForPush({ kind: "device_request" })).toEqual({ kind: "none" });`.

`src/platform/push.ts`: replace `handle` with:

```ts
// APNs payloads carry kind and ref at the top level (apps/api/src/push/messages.ts); expo-notifications puts only a
// "body" key into content.data for remote notifications, so read the raw payload from the push trigger.
function pushData(response: Notifications.NotificationResponse): Record<string, unknown> {
  const { trigger, content } = response.notification.request;
  if (trigger !== null && typeof trigger === "object" && "type" in trigger && trigger.type === "push") return trigger.payload ?? {};
  return content.data ?? {};
}

function handle(response: Notifications.NotificationResponse | null): void {
  if (response === null) return;
  const action = actionForPush(pushData(response));
  if (action.kind === "refresh_device") void refreshDeviceNow();
  if (action.kind === "approve_device") router.push(`/devices/approve?id=${encodeURIComponent(action.deviceId)}`);
}
```

(with `import { router } from "expo-router";`). If `tsc` narrows `trigger` differently, keep the same logic with a type guard; do not cast.

`src/platform/device.ts`, the changes:

1. Imports: add `adoptAccountKey`, `getAccountKey`, `revealPairing`, `verifyCertificate` to the keys-module import; `import type { DeviceView } from "@waypoint/contracts";`; `ApiCallError` is already imported; `import { accountStep, knownDevicesKey, newDeviceStep, pairingApproverKey, parseApprover, parseKnown, updateKnown } from "../core/device/devices.ts";`; `deleteSetting` from settings; `useState` from React.
2. In-flight registration keyed by Clerk id. Replace `let running: Promise<void> | null = null;` and `refreshDevice` with:

```ts
let running: { clerkId: string; promise: Promise<void> } | null = null;

function refreshDevice(clerkUserId: string): Promise<void> {
  if (running !== null && running.clerkId === clerkUserId) return running.promise;
  const promise: Promise<void> = register(clerkUserId)
    .catch((error: unknown) => {
      if (clerkId !== clerkUserId) return; // signed out or switched person meanwhile: show nothing
      if (status === "approved" || status === "waiting") return;
      if (error instanceof ApiCallError && error.status === 429) setStatus("too_many_waiting");
      else if (error instanceof NetworkError) setStatus("offline");
      else setStatus("failed");
    })
    .finally(() => {
      if (running?.promise === promise) running = null;
    });
  running = { clerkId: clerkUserId, promise };
  return promise;
}
```

   and in `register`, put `if (clerkId !== clerkUserId) return;` immediately before each `return approve(…)`, `return wait(…)` and the final `wait(user)` (four places), so a pass for a person who has signed out never sets the signer or status.
3. In `register`, the `approved` line becomes:

```ts
  if (plan.kind === "approved") {
    if (clerkId !== clerkUserId) return;
    approve(user, plan.deviceId);
    await syncAccountKey(user, list.devices, plan.deviceId);
    return;
  }
```

   with, above `register`:

```ts
// True when this approved iPhone could not open its account key (M27b-C): Settings › Devices says so.
let accountKeyProblem = false;
export const hasAccountKeyProblem = (): boolean => accountKeyProblem;

// Takes a replaced account key, and grows the list of devices this iPhone vouches for (docs/security.md section 6).
async function syncAccountKey(user: string, devices: DeviceView[], myId: string): Promise<void> {
  const db = getDb();
  const keys = getDeviceKeys(user);
  const known = parseKnown(getSetting(db, knownDevicesKey(user)));
  const step = accountStep(devices, myId, getAccountKey(user)?.accountId ?? null);
  accountKeyProblem = step.kind === "missing";
  if (step.kind === "adopt") {
    const approver = parseApprover(getSetting(db, pairingApproverKey(user)));
    const trusted = { ...known };
    if (approver !== null) trusted[approver.id] = approver.signPub;
    if (keys !== null) trusted[keys.deviceId] = keys.signPub; // a removal this iPhone made, whose reply was lost
    try {
      await adoptAccountKey(user, step.account, step.envelope, trusted);
      writeDb((d) => deleteSetting(d, pairingApproverKey(user)));
    } catch {
      accountKeyProblem = true;
    }
  }
  const held = getAccountKey(user);
  if (held === null) return;
  const next = updateKnown(known, devices, held.signPub, (c) => verifyCertificate({ ...c, userId: user }));
  writeDb((d) => setSetting(d, knownDevicesKey(user), JSON.stringify(next)));
}
```

4. The new iPhone's side of pairing, added at the end of the file:

```ts
export type PairingState = { kind: "none" } | { kind: "wait_approver" } | { kind: "code"; code: string } | { kind: "expired" };

// While the waiting screen is open: polls the pairing every 3 s, reveals once the approver's nonce is in, and shows
// the code (docs/security.md section 8).
export function usePairing(): PairingState {
  const current = useDeviceStatus();
  const [state, setState] = useState<PairingState>({ kind: "none" });
  useEffect(() => {
    const user = userId;
    const keys = user === null ? null : getDeviceKeys(user);
    if (current !== "waiting" || user === null || keys === null) return;
    let stopped = false;
    const tick = async (): Promise<void> => {
      try {
        const view = await api.pairing(keys.deviceId);
        const step = newDeviceStep(view, Date.now() + api.clockOffset());
        if (stopped) return;
        if (step.kind === "expired" || step.kind === "wait_approver") return setState({ kind: step.kind });
        const approver = view.approver;
        if (approver === null || view.approver_nonce === null) return;
        writeDb((db) => setSetting(db, pairingApproverKey(user), JSON.stringify({ id: approver.id, signPub: approver.sign_pub })));
        const revealed = await revealPairing(user, approver.sign_pub, view.approver_nonce);
        if (step.kind === "reveal") await api.revealPairing(keys.deviceId, revealed.nonce, signerFor(user, keys.deviceId));
        if (!stopped) setState({ kind: "code", code: revealed.code });
      } catch (error) {
        // The pairing is gone (approved, or ended by a wrong reveal): check; still waiting means start again.
        if (error instanceof ApiCallError && (error.status === 404 || error.status === 409)) {
          await refreshDeviceNow();
          if (!stopped && status === "waiting") setState({ kind: "expired" });
        }
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 3_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [current]);
  return state;
}

// An expired or failed pairing: forget this iPhone's keys and register again with a new id and commitment.
export async function startPairingAgain(): Promise<void> {
  const user = userId;
  if (user === null) return;
  await deleteDeviceKeys(user);
  writeDb((db) => deleteSetting(db, pairingApproverKey(user)));
  await refreshDeviceNow();
}
```

`src/platform/devices.ts`, exactly:

```ts
import { ApiCallError } from "@waypoint/api-client";
import type { DeviceView } from "@waypoint/contracts";
import { randomUUID } from "expo-crypto";
import {
  certifyDevice,
  deleteDeviceKeys,
  finishAccountRotation,
  getDeviceKeys,
  newPairingNonce,
  pairingCode,
  rotateAccountKey,
} from "../../modules/waypoint-keys/index.ts";
import { approverStep, removalPlan } from "../core/device/devices.ts";
import { api } from "./api.ts";
import { currentUserId, refreshDeviceNow } from "./device.ts";

// This iPhone's nonce for each pairing it started, this launch only, keyed by user id and device id.
const approverNonces = new Map<string, string>();
const slot = (user: string, deviceId: string): string => `${user}:${deviceId}`;

export async function listDevices(): Promise<{ userId: string; devices: DeviceView[] }> {
  const list = await api.devices();
  return { userId: list.user_id, devices: list.devices };
}

export type ApprovalView =
  | { kind: "waiting_reveal" }
  | { kind: "code"; code: string }
  | { kind: "mismatch" } // the new device's nonce does not match its commitment: never approve
  | { kind: "taken" }
  | { kind: "expired" }
  | { kind: "lost" } // this iPhone started the pairing but no longer has its nonce (the app restarted)
  | { kind: "gone" }; // approved or removed meanwhile

// One step of approving a waiting device: start it, or work out the code once the new device revealed.
export async function pollApproval(deviceId: string): Promise<ApprovalView> {
  const user = currentUserId();
  const me = user === null ? null : getDeviceKeys(user);
  if (user === null || me === null) return { kind: "gone" };
  let view;
  try {
    view = await api.pairing(deviceId);
  } catch (error) {
    if (error instanceof ApiCallError && error.status === 404) return { kind: "gone" };
    throw error;
  }
  const step = approverStep(view, me.deviceId, Date.now() + api.clockOffset());
  const key = slot(user, deviceId);
  if (step.kind === "start") {
    const nonce = newPairingNonce();
    approverNonces.set(key, nonce);
    try {
      await api.sendPairingNonce(deviceId, nonce);
    } catch (error) {
      if (error instanceof ApiCallError && error.status === 409) return { kind: "taken" };
      throw error;
    }
    return { kind: "waiting_reveal" };
  }
  if (step.kind === "taken" || step.kind === "expired") return { kind: step.kind };
  const nonce = approverNonces.get(key);
  if (nonce === undefined) return { kind: "lost" };
  if (step.kind === "wait_reveal") return { kind: "waiting_reveal" };
  const target = (await api.devices()).devices.find((d) => d.kind === "device" && d.id === deviceId);
  if (target === undefined || target.approved_at !== null) return { kind: "gone" };
  try {
    const code = pairingCode({
      newSignPub: target.sign_pub,
      newBoxPub: target.box_pub,
      commitment: view.commitment,
      approverSignPub: me.signPub,
      approverNonce: nonce,
      newNonce: step.deviceNonce,
    });
    return { kind: "code", code };
  } catch {
    return { kind: "mismatch" };
  }
}

// "They match": certify the new device and give it the account key (M28b adds the group keys).
export async function approveWaiting(deviceId: string): Promise<void> {
  const user = currentUserId();
  if (user === null) throw new Error("signed out");
  const target = (await api.devices()).devices.find((d) => d.kind === "device" && d.id === deviceId);
  if (target === undefined) throw new Error("no such device");
  const made = await certifyDevice(user, { id: target.id, signPub: target.sign_pub, boxPub: target.box_pub }, false);
  await api.approveDevice(deviceId, { cert: made.cert, account_envelope: made.accountEnvelope, envelopes: [] });
  approverNonces.delete(slot(user, deviceId));
}

export type RemoveResult = "removed" | "removed_self" | "changed";

// Removes a device (docs/security.md section 12). "changed": the list changed meanwhile; reload and ask again.
export async function removeDevice(targetId: string): Promise<RemoveResult> {
  const user = currentUserId();
  const me = user === null ? null : getDeviceKeys(user);
  if (user === null || me === null) throw new Error("signed out");
  const plan = removalPlan((await api.devices()).devices, targetId);
  if (plan === null) return "removed";
  if (plan.kind === "plain") {
    await api.removeDevice(targetId, {});
  } else {
    const accountId = randomUUID();
    const rotated = await rotateAccountKey(user, accountId, plan.remaining);
    try {
      await api.removeDevice(targetId, {
        account: { id: rotated.account.id, sign_pub: rotated.account.signPub, box_pub: rotated.account.boxPub },
        devices: rotated.devices.map((d) => ({ id: d.id, cert: d.cert, account_envelope: d.accountEnvelope })),
      });
    } catch (error) {
      if (error instanceof ApiCallError) {
        await finishAccountRotation(user, accountId, false);
        if (error.status === 409 && error.message === "devices changed, try again") return "changed";
      }
      // A lost reply keeps the pending key; the next refresh adopts our own envelope if the removal went through.
      throw error;
    }
    await finishAccountRotation(user, accountId, true);
  }
  if (targetId === me.deviceId) {
    await deleteDeviceKeys(user);
    return "removed_self";
  }
  await refreshDeviceNow();
  return "removed";
}
```

Screens (copy written for this card; check it against A4–A6 and J1–J3):

- **`DevicesScreen`** (`/devices`, Settings row "Devices" under ACCOUNT, after "Recovery key"): title "Devices". Loads `listDevices()` on focus and on pull to refresh. One `Row` per `deviceRows(…)`: title the device's name, subtitle "This iPhone", "Waiting for approval" or "Added " + `dateLine(addedAt, -new Date().getTimezoneOffset())` (from `src/core/capture/labels.ts`). A waiting row opens `/devices/approve?id=…`. Another approved row opens an `Alert`: "Remove {name}?", "It won't be able to use credits or open anything new. Notes already on it stay on it.", buttons "Cancel" and "Remove" (destructive) → `removeDevice(id)`: `changed` → `Alert` "Your devices changed" / "Check the list and try again." and reload; any error → caption "Couldn't remove it. Try again." This iPhone's row opens "Remove this iPhone?" / "Waypoint signs out on this iPhone. Your notes on it stay here." → `removeDevice` → on `removed_self`, `useSignOut()` from `src/platform/auth.tsx`. After any removal of an approved device, caption at the top: "Make a new recovery key: your old one stopped working." with a link to `/recovery-words`. When `hasAccountKeyProblem()`: a caption "This iPhone doesn't have your account key. Remove it from another device and add it again." Empty or offline: "Can't load devices offline."
- **`ApproveDeviceScreen`** (`/devices/approve?id=`): title "Approve a new device". Calls `pollApproval(id)` at once and every 2 s while focused, until it returns `code`, `mismatch`, `taken`, `expired`, `lost` or `gone`.
  - `waiting_reveal`: body "Open Waypoint on the new device. It shows a 6-digit code in a moment." and a spinner.
  - `code`: the code in large digits ("123 456"), body "Does the new device show the same code?", buttons "They match" (primary) → `approveWaiting(id)` → body "Approved. It can use your account now." and "Done"; "They don't match" → `removeDevice(id)` → body "Removed. Nothing was shared with it." On `no_account_key` from `approveWaiting`: "This iPhone can't approve devices. Use another device, or the recovery key on the new one."
  - `mismatch`: body "Something's wrong with this request. Don't approve it." and "Remove it" (→ `removeDevice`).
  - `taken`: "Another of your devices is approving it." `expired`: "This request ran out of time. Start again on the new device." `lost`: "Start again on the new device." and "Remove this request" (→ `removeDevice`). `gone`: "This device was already approved or removed."
- **`DeviceWaitingScreen`** (`waiting`): uses `usePairing()`. Body becomes "Open Waypoint on your other iPhone or iPad, go to Settings › Devices, and approve this one." `code`: show "Your code" and the code in large digits, caption "Check that your other device shows the same code." `expired`: title stays, body "This request ran out of time.", primary button "Start again" → `startPairingAgain()`. The M27b-B recovery button stays.

Checks without Xcode: root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.

Device check (two iPhones, or an iPhone and the Simulator; run once Xcode is installed):
1. Phone B signs in to phone A's account and waits. Phone A gets the "new device" notification; tapping it opens the approval screen. Both show the same 6 digits. "They match": B becomes approved within a few seconds (push or "Check again"), and `getAccountKey` on B equals the account row.
2. Repeat with "They don't match": B's row is removed; B shows "Start again".
3. Let B wait 10 minutes without approving: B shows "This request ran out of time"; "Start again" registers a new row (new id) and approval works.
4. On A, remove B: D1 shows a new account row, new certificates, the recovery row deleted; A's words screen opens on the next launch. B can no longer spend credits.
5. With three devices A, B, C approved, remove C on A and B at the same moment: one succeeds, the other shows "Your devices changed". Both A and B still hold the same account key afterwards (B adopted it on its next refresh).
6. Sign out on A during step 1 (while "Checking"): after signing in as another person, no request is signed with the first person's keys (watch the `Waypoint-Device` header in the Worker logs).
7. Tap a `device_approved` notification on B: it refreshes (the payload fix).

Not in this PR: group keys during approval, recovery and rotation (M28b); a security review of the copy (open question 50).

---
## 4. Cloud jobs: M34, M18, M19

### M34 · Cloud jobs: start, follow, open the sealed result, delete; the jobs list; the quote box

Branch `pr/m34-jobs`. After M3b, M15 (`sent_log`, `src/core/cloud/failure.ts`, `src/platform/tasks.ts`'s `toFailure`) and M20 (merged). No new dependencies. Files, all under `apps/mobile/`:
- `src/core/db/schema.ts` (migration 3), `test/migrate.test.ts` (2 → 3), `src/core/jobs/jobs.ts`, `src/core/jobs/bytes.ts` (new), `test/jobs.test.ts` (new);
- `src/core/explain/sent.ts` (`SentTask` widened, one line), `src/core/push/push.ts`, `test/push.test.ts` (the `job_ready` lines);
- `src/platform/jobs.ts`, `src/platform/jobResults.ts`, `src/platform/jobKinds.ts` (new), `src/platform/push.ts` (one action);
- `src/ui/QuoteBox.tsx` (new); `src/features/jobs/JobScreen.tsx`, `src/features/jobs/JobsScreen.tsx` (new); `src/app/job/[id].tsx`, `src/app/jobs.tsx` (new), `src/app/_layout.tsx` (two screen lines), `src/app/(tabs)/_layout.tsx` (one hook and one import), `src/features/settings/SettingsScreen.tsx` (one row).

Why it looks like this (`docs/architecture.md` flow 2, section 4 job rules; `docs/security.md` section 14):
- Every long job (research, overviews, slides, diagrams, mini apps, practice sets, the second transcript) has the same life: quote, `POST /v1/jobs` (signed, with the Idempotency-Key made when the person tapped), follow `GET /v1/jobs/:id/events`, fetch `GET /v1/jobs/:id/result` (signed; only this iPhone gets it), open it with M26b's `openSealedResult`, save it locally, then `DELETE /v1/jobs/:id`, which also deletes the result on the server. This card does that once; each job card adds only what is particular to its type.
- **There is no `GET /v1/jobs` list**, so the device keeps its own `jobs` table: the id, the type, the session it belongs to, the request key, the last state seen, and a small `detail` JSON the type's card owns (never the text that was sent). At launch and whenever the app comes back, every job not finished locally is picked up again, so an app closed mid-job still ends up with its result (results stay 7 days on the server).
- **Savers.** A job type's card registers a function that turns the opened text into its own tables (`RESULT_SAVERS`), the screen that shows it (`RESULT_ROUTES`) and, if needed, work before following (`BEFORE_FOLLOW`, used by M18 to upload audio). A result that cannot be opened (the iPhone's keys changed) or does not parse is marked `unreadable`; the job is still deleted on the server.
- **`sent_log`.** The request body (or, for the second transcript, a summary with the audio size) is written before the request is sent, keyed by the request's Idempotency-Key (stage 2 rule 3); the credits charged and the route's retention are written when the job finishes (0 when it failed).
- **Money.** "Try again" after Out of credits re-sends with the **same** key (no hold was made); after a failed job, a new tap makes a new key. Cancelling a queued or running job releases its hold (`docs/architecture.md` job rules).
- **`job_ready` push** opens the job's screen and starts following it. Only a job that succeeded sends it (PR 20 rule), so failures show when the app next looks.
- The "Before you run it" box is a plain component in `src/ui/` so that every job's feature can show it.

`src/core/db/schema.ts`: append to `MIGRATIONS`, exactly:

```ts
  {
    version: 3,
    sql: `
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('research', 'overview_script', 'video_slides', 'diagram', 'mini_app', 'practice', 'retranscribe')),
  session_id TEXT REFERENCES sessions (id) ON DELETE CASCADE,
  request_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  quoted INTEGER NOT NULL CHECK (quoted >= 1),
  spent INTEGER CHECK (spent >= 0),
  result_ready INTEGER NOT NULL DEFAULT 0 CHECK (result_ready IN (0, 1)),
  detail TEXT NOT NULL DEFAULT '{}',
  saved_at INTEGER,
  deleted_at INTEGER,
  problem TEXT CHECK (problem IN ('unreadable')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX jobs_open ON jobs (deleted_at, created_at);
CREATE INDEX jobs_session ON jobs (session_id, created_at);
`,
  },
```

`src/core/jobs/jobs.ts`, exactly:

```ts
import type { JobType, JobView } from "@waypoint/contracts";
import type { SqlDb } from "../db/sql.ts";

// Cloud jobs this iPhone started (PR 20). The server forgets a job's result after 7 days and after DELETE; this
// table is how the app finds its jobs again (there is no GET /v1/jobs list) and what each one is for.

export type LocalJob = {
  id: string;
  type: JobType;
  sessionId: string | null;
  requestKey: string;
  state: JobView["state"];
  quoted: number;
  spent: number | null;
  resultReady: boolean;
  detail: string; // JSON the job's card defines (for example the research question); never the text sent
  savedAt: number | null;
  deletedAt: number | null;
  problem: "unreadable" | null;
  createdAt: number;
  updatedAt: number;
};

type Row = {
  id: string;
  type: JobType;
  session_id: string | null;
  request_key: string;
  state: JobView["state"];
  quoted: number;
  spent: number | null;
  result_ready: number;
  detail: string;
  saved_at: number | null;
  deleted_at: number | null;
  problem: "unreadable" | null;
  created_at: number;
  updated_at: number;
};

const COLUMNS = "id, type, session_id, request_key, state, quoted, spent, result_ready, detail, saved_at, deleted_at, problem, created_at, updated_at";

function fromRow(r: Row): LocalJob {
  return {
    id: r.id,
    type: r.type,
    sessionId: r.session_id,
    requestKey: r.request_key,
    state: r.state,
    quoted: r.quoted,
    spent: r.spent,
    resultReady: r.result_ready === 1,
    detail: r.detail,
    savedAt: r.saved_at,
    deletedAt: r.deleted_at,
    problem: r.problem,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// The job POST /v1/jobs returned. A repeat of the same job (same id) only refreshes its state.
export function recordJob(db: SqlDb, job: JobView, info: { sessionId: string | null; requestKey: string; detail: unknown; now: number }): void {
  db.run(
    `INSERT INTO jobs (id, type, session_id, request_key, state, quoted, spent, result_ready, detail, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET state = excluded.state, spent = excluded.spent, result_ready = excluded.result_ready, updated_at = excluded.updated_at`,
    [job.id, job.type, info.sessionId, info.requestKey, job.state, job.quoted, job.spent, job.result_ready ? 1 : 0, JSON.stringify(info.detail ?? {}), info.now, info.now],
  );
}

// A newer view of a job (events stream, GET /v1/jobs/:id). Unknown ids are ignored.
export function updateJob(db: SqlDb, job: JobView, now: number): void {
  db.run("UPDATE jobs SET state = ?, spent = ?, result_ready = ?, updated_at = ? WHERE id = ?", [job.state, job.spent, job.result_ready ? 1 : 0, now, job.id]);
}

export function getJob(db: SqlDb, id: string): LocalJob | null {
  const row = db.get<Row>(`SELECT ${COLUMNS} FROM jobs WHERE id = ?`, [id]);
  return row === null ? null : fromRow(row);
}

export function listJobs(db: SqlDb, limit = 50): LocalJob[] {
  return db.all<Row>(`SELECT ${COLUMNS} FROM jobs ORDER BY created_at DESC LIMIT ?`, [limit]).map(fromRow);
}

export function jobsForSession(db: SqlDb, sessionId: string): LocalJob[] {
  return db.all<Row>(`SELECT ${COLUMNS} FROM jobs WHERE session_id = ? ORDER BY created_at DESC`, [sessionId]).map(fromRow);
}

export function markSaved(db: SqlDb, id: string, now: number): void {
  db.run("UPDATE jobs SET saved_at = COALESCE(saved_at, ?), updated_at = ? WHERE id = ?", [now, now, id]);
}

// The result arrived but could not be opened or read on this iPhone: nothing more can be done with it.
export function markUnreadable(db: SqlDb, id: string, now: number): void {
  db.run("UPDATE jobs SET problem = 'unreadable', saved_at = COALESCE(saved_at, ?), updated_at = ? WHERE id = ?", [now, now, id]);
}

// Merges keys into the job's detail JSON (an upload's progress, for example).
export function setDetail(db: SqlDb, id: string, detail: Record<string, unknown>, now: number): void {
  const job = getJob(db, id);
  if (job === null) return;
  let current: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(job.detail);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
  } catch {
    current = {};
  }
  db.run("UPDATE jobs SET detail = ?, updated_at = ? WHERE id = ?", [JSON.stringify({ ...current, ...detail }), now, id]);
}

export const JOB_LABELS: Record<JobType, string> = {
  research: "Research",
  overview_script: "Audio overview",
  video_slides: "Video overview",
  diagram: "Diagram",
  mini_app: "Mini app",
  practice: "Practice set",
  retranscribe: "Second transcript",
};

// One line for the jobs list and the job screen.
export function jobLine(job: LocalJob): string {
  if (job.problem === "unreadable") return "Couldn't open the result on this iPhone";
  switch (job.state) {
    case "queued":
    case "running":
      return "Working on it";
    case "succeeded":
      return job.savedAt === null ? "Getting the result" : `Ready · ${job.spent ?? job.quoted} credits`;
    case "failed":
      return "Didn't work · nothing charged";
    case "cancelled":
      return job.spent !== null && job.spent > 0 ? `Cancelled · ${job.spent} credits used` : "Cancelled · nothing charged";
  }
}

export function markDeleted(db: SqlDb, id: string, now: number): void {
  db.run("UPDATE jobs SET deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE id = ?", [now, now, id]);
}

// What the app still has to do for a job, in order.
export type JobNext = "follow" | "fetch" | "delete" | "done";

export function nextStep(job: LocalJob): JobNext {
  if (job.deletedAt !== null) return "done";
  if (job.state === "queued" || job.state === "running") return "follow";
  if (job.state === "succeeded" && job.resultReady && job.savedAt === null) return "fetch";
  // Saved, or finished without a result (failed, cancelled, or the result is gone): tell the server we are done.
  return "delete";
}

// Jobs to pick up again at launch: anything not done.
export function openJobs(db: SqlDb): LocalJob[] {
  return db.all<Row>(`SELECT ${COLUMNS} FROM jobs WHERE deleted_at IS NULL ORDER BY created_at`).map(fromRow).filter((j) => nextStep(j) !== "done");
}
```

`src/core/jobs/bytes.ts`, exactly:

```ts
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// Base64url without padding (docs/security.md section 4), without btoa so Node and Hermes give the same text.
export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]!;
  }
  return out;
}
```

`src/core/explain/sent.ts` (M15's file): `export type SentTask = "explain" | "more_detail" | "double_check";` becomes `export type SentTask = "explain" | "more_detail" | "double_check" | JobType;`, with `import type { JobType } from "@waypoint/contracts";`. The `sent_log.task` CHECK in migration 2 already allows every job type.

`src/core/push/push.ts`: `PushAction` gains `| { kind: "open_job"; jobId: string }`; `actionForPush` gains `if (data.kind === "job_ready" && typeof data.ref === "string") return { kind: "open_job", jobId: data.ref };`. In `test/push.test.ts` the `job_ready` line becomes `expect(actionForPush({ kind: "job_ready", ref: "job_1" })).toEqual({ kind: "open_job", jobId: "job_1" });`. `src/platform/push.ts`'s `handle` adds `if (action.kind === "open_job") { void followJob(action.jobId); router.push(`/job/${encodeURIComponent(action.jobId)}`); }` (import `followJob` from `./jobs.ts`).

`src/platform/jobResults.ts`, exactly:

```ts
import type { JobType } from "@waypoint/contracts";
import type { SqlDb } from "../core/db/sql.ts";
import type { LocalJob } from "../core/jobs/jobs.ts";

// What each job type does with its opened result, where its screen is, and anything to do before following it.
// Each job card adds one line to each map it needs (M18, M19, M23, M24b, M25a, M25b).
export const RESULT_SAVERS: Partial<Record<JobType, (db: SqlDb, job: LocalJob, text: string) => void>> = {};
export const RESULT_ROUTES: Partial<Record<JobType, (job: LocalJob) => string>> = {};
export const BEFORE_FOLLOW: Partial<Record<JobType, (job: LocalJob) => Promise<void>>> = {};
```

`src/platform/jobKinds.ts`, exactly (each job card adds one `import "./<its module>.ts";` line, so its savers are registered before `useJobs` resumes anything):

```ts
// Imports every job type's platform module for its registrations in jobResults.ts. Imported once by (tabs)/_layout.tsx.
export {};
```

`src/platform/jobs.ts`, exactly:

```ts
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { ApiCallError, NetworkError } from "@waypoint/api-client";
import type { CreateJobRequest, JobView, QuoteRequest, QuoteResponse } from "@waypoint/contracts";
import { openSealedResult } from "../../modules/waypoint-keys/index.ts";
import type { CloudFailure } from "../core/cloud/failure.ts";
import { logSent, settleSent } from "../core/explain/sent.ts";
import { toBase64Url } from "../core/jobs/bytes.ts";
import { getJob, markDeleted, markSaved, markUnreadable, nextStep, openJobs, recordJob, updateJob, type LocalJob } from "../core/jobs/jobs.ts";
import { api } from "./api.ts";
import { getDb, writeDb } from "./db.ts";
import { currentUserId, requireApprovedDevice, useDeviceStatus } from "./device.ts";
import { BEFORE_FOLLOW, RESULT_SAVERS } from "./jobResults.ts";
import { toFailure } from "./tasks.ts";

const FINISHED = new Set<JobView["state"]>(["succeeded", "failed", "cancelled"]);

// A newer view of a job. When it has finished, sent_log gets the credits charged (0 when it failed).
function note(view: JobView): void {
  writeDb((db) => {
    updateJob(db, view, Date.now());
    const job = getJob(db, view.id);
    if (job !== null && FINISHED.has(view.state)) settleSent(db, job.requestKey, view.spent ?? 0, view.retention);
  });
}

export type StartJobInput = {
  request: CreateJobRequest;
  key: string; // made when the person tapped; kept for "Try again" after Out of credits
  sessionId: string | null;
  detail: Record<string, unknown>; // what the job's screen needs later (never the text sent)
  sent?: unknown; // what sent_log records, when it is not the request itself (retranscribe)
};

// Logs what is sent, makes the job, and starts following it. A failure is returned, never thrown.
export async function startJob(input: StartJobInput): Promise<{ ok: true; jobId: string } | { ok: false; failure: CloudFailure }> {
  if (!requireApprovedDevice()) return { ok: false, failure: { kind: "device" } };
  writeDb((db) => logSent(db, { id: input.key, task: input.request.type, sessionId: input.sessionId, body: input.sent ?? input.request, at: Date.now() }));
  try {
    const view = await api.createJob(input.request, input.key);
    writeDb((db) => recordJob(db, view, { sessionId: input.sessionId, requestKey: input.key, detail: input.detail, now: Date.now() }));
    void followJob(view.id);
    return { ok: true, jobId: view.id };
  } catch (error) {
    return { ok: false, failure: toFailure(error) };
  }
}

// Opens the sealed result with this iPhone's key and hands it to the job type's saver. false: nothing to do yet.
async function fetchResult(job: LocalJob): Promise<boolean> {
  const save = RESULT_SAVERS[job.type];
  const user = currentUserId();
  if (save === undefined || user === null) return false;
  const sealed = await api.jobResult(job.id);
  try {
    const text = await openSealedResult(user, job.id, toBase64Url(sealed));
    writeDb((db) => {
      save(db, job, text);
      markSaved(db, job.id, Date.now());
    });
  } catch {
    writeDb((db) => markUnreadable(db, job.id, Date.now()));
  }
  return true;
}

const following = new Set<string>();
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Walks one job to the end: follow its events, fetch and open the result, then DELETE it on the server (which also
// deletes the result). Safe to call again at any time; one walk per job at a time. Network trouble backs off; any
// other error stops until the next launch.
export async function followJob(id: string): Promise<void> {
  if (following.has(id)) return;
  following.add(id);
  try {
    for (let failures = 0; failures < 8; ) {
      const job = getJob(getDb(), id);
      if (job === null) return;
      const step = nextStep(job);
      if (step === "done") return;
      try {
        if (step === "follow") {
          const before = BEFORE_FOLLOW[job.type];
          if (before !== undefined) await before(job);
          await api.jobEvents(id, note);
        } else if (step === "fetch") {
          if (!(await fetchResult(job))) return;
        } else {
          const view = await api.deleteJob(id);
          note(view);
          writeDb((db) => markDeleted(db, id, Date.now()));
        }
        failures = 0;
      } catch (error) {
        if (error instanceof ApiCallError && error.status === 404) {
          writeDb((db) => markDeleted(db, id, Date.now()));
          return;
        }
        if (!(error instanceof NetworkError)) return;
        failures += 1;
        await wait(Math.min(30_000, 1_000 * 2 ** failures));
      }
    }
  } finally {
    following.delete(id);
  }
}

// Cancel from the job screen. Nothing is charged unless the job had already finished (docs/architecture.md section 4).
export async function cancelJob(id: string): Promise<CloudFailure | null> {
  try {
    note(await api.deleteJob(id));
    writeDb((db) => markDeleted(db, id, Date.now()));
    return null;
  } catch (error) {
    return toFailure(error);
  }
}

// Picks up every unfinished job at launch and whenever the app comes back. Called once in (tabs)/_layout.tsx.
export function useJobs(): void {
  const status = useDeviceStatus();
  useEffect(() => {
    if (status !== "approved") return;
    const resume = (): void => {
      for (const job of openJobs(getDb())) void followJob(job.id);
    };
    resume();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") resume();
    });
    return () => sub.remove();
  }, [status]);
}

export type QuoteState = { loading: boolean; quote: QuoteResponse | null; failure: CloudFailure | null };

// POST /v1/tasks/quote for the "Before you run it" box. null: nothing to quote yet.
export function useQuote(request: QuoteRequest | null): QuoteState {
  const key = request === null ? "" : JSON.stringify(request);
  const [state, setState] = useState<QuoteState>({ loading: request !== null, quote: null, failure: null });
  useEffect(() => {
    if (request === null) return;
    let live = true;
    setState({ loading: true, quote: null, failure: null });
    api.quote(request).then(
      (quote) => live && setState({ loading: false, quote, failure: null }),
      (error: unknown) => live && setState({ loading: false, quote: null, failure: toFailure(error) }),
    );
    return () => {
      live = false;
    };
  }, [key]);
  return state;
}
```

`src/app/(tabs)/_layout.tsx`: add `import "../../platform/jobKinds.ts";` and `useJobs();` (from `../../platform/jobs.ts`) after `usePush();`.

`src/ui/QuoteBox.tsx`: props `{ state: QuoteState; onShowSent?: () => void }` (the type from `src/platform/jobs.ts`; a `ui` file may import a type). Caption "BEFORE YOU RUN IT"; while loading, caption "Checking the price…"; with a quote, a `Row` titled "`credits` credits" with right caption "`balance_after` left after", then a caption with "Sent for this task only" (`retention` `standard`) or "Not stored in the cloud" (`zero`), and, when `onShowSent` is given, an accent text button "Show what's sent". With a failure, `failureCopy(failure)`'s title and body (from `src/core/cloud/failure.ts`).

`src/features/jobs/JobScreen.tsx` (`/job/[id]`): reads the job with `useQuery((db) => getJob(db, id), id)`. Title `JOB_LABELS[job.type]`, subtitle `jobLine(job)`.
- Queued or running: body "Working on it. You can leave this screen; you'll get a notification when it's ready." a spinner, `SecondaryButton` "Notify me" (M20's `askForPush`, shown only while notifications are not allowed), and a text button "Cancel" → `Alert` "Cancel this job?" / "Nothing is charged unless it has already finished." → `cancelJob(id)`.
- Succeeded and saved: `PrimaryButton` "Open" → `RESULT_ROUTES[job.type]?.(job)` (hidden when the type has no route yet).
- Failed: body "It didn't work. Nothing was charged." Cancelled: body from `jobLine`. Unreadable: body "The result arrived but couldn't be opened on this iPhone. This can happen after its security keys changed."
- On focus it calls `void followJob(id)`.

`src/features/jobs/JobsScreen.tsx` (`/jobs`, Settings row "Cloud jobs" under ACCOUNT): `listJobs` newest first; each `Row` title `JOB_LABELS[type]`, subtitle `jobLine(job)` and `dateLine(createdAt, …)`; pressing opens `/job/<id>`. Empty: "No cloud jobs yet."

`test/jobs.test.ts`, exactly:

```ts
import type { JobView } from "@waypoint/contracts";
import { describe, expect, it } from "vitest";
import { toBase64Url } from "../src/core/jobs/bytes.ts";
import { getJob, listJobs, jobLine, markDeleted, markSaved, markUnreadable, nextStep, openJobs, recordJob, setDetail, updateJob } from "../src/core/jobs/jobs.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { createMemoryDb } from "./helpers/db.ts";

const VIEW: JobView = { id: "job_1", type: "research", state: "queued", quoted: 15, spent: null, tier: "standard", retention: "standard", result_ready: false, created_at: 1, finished_at: null, expires_at: null };
function db() {
  const d = createMemoryDb();
  migrate(d);
  return d;
}

describe("jobs table", () => {
  it("records, updates and walks a job to done", () => {
    const d = db();
    recordJob(d, VIEW, { sessionId: null, requestKey: "key_1", detail: { depth: "quick" }, now: 10 });
    recordJob(d, { ...VIEW, state: "running" }, { sessionId: null, requestKey: "key_1", detail: {}, now: 11 });
    expect(getJob(d, "job_1")).toMatchObject({ state: "running", detail: '{"depth":"quick"}', createdAt: 10, updatedAt: 11 });
    expect(nextStep(getJob(d, "job_1")!)).toBe("follow");
    updateJob(d, { ...VIEW, state: "succeeded", spent: 15, result_ready: true }, 12);
    expect(nextStep(getJob(d, "job_1")!)).toBe("fetch");
    markSaved(d, "job_1", 13);
    expect(nextStep(getJob(d, "job_1")!)).toBe("delete");
    expect(openJobs(d).map((j) => j.id)).toEqual(["job_1"]);
    markDeleted(d, "job_1", 14);
    expect(nextStep(getJob(d, "job_1")!)).toBe("done");
    expect(openJobs(d)).toEqual([]);
    expect(listJobs(d)).toHaveLength(1);
  });
  it("failed and cancelled jobs only need the DELETE", () => {
    const d = db();
    recordJob(d, { ...VIEW, state: "failed", spent: 0 }, { sessionId: null, requestKey: "key_2", detail: {}, now: 1 });
    expect(nextStep(getJob(d, "job_1")!)).toBe("delete");
  });
  it("a request key belongs to one job", () => {
    const d = db();
    recordJob(d, VIEW, { sessionId: null, requestKey: "key_1", detail: {}, now: 1 });
    expect(() => recordJob(d, { ...VIEW, id: "job_2" }, { sessionId: null, requestKey: "key_1", detail: {}, now: 1 })).toThrow();
  });
});

describe("details and lines", () => {
  it("setDetail merges; markUnreadable ends the fetch; jobLine", () => {
    const d = db();
    recordJob(d, { ...VIEW, type: "retranscribe" }, { sessionId: null, requestKey: "key_1", detail: { parts: 3 }, now: 1 });
    setDetail(d, "job_1", { uploaded: 2 }, 2);
    expect(JSON.parse(getJob(d, "job_1")!.detail)).toEqual({ parts: 3, uploaded: 2 });
    expect(jobLine(getJob(d, "job_1")!)).toBe("Working on it");
    updateJob(d, { ...VIEW, state: "succeeded", spent: 3, result_ready: true }, 3);
    expect(jobLine(getJob(d, "job_1")!)).toBe("Getting the result");
    markUnreadable(d, "job_1", 4);
    expect(nextStep(getJob(d, "job_1")!)).toBe("delete");
    expect(jobLine(getJob(d, "job_1")!)).toBe("Couldn't open the result on this iPhone");
  });
});

describe("toBase64Url", () => {
  it("matches Node for every length mod 3", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 64, 1000]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
      expect(toBase64Url(bytes)).toBe(Buffer.from(bytes).toString("base64url"));
    }
  });
});
```

Checks without Xcode: root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`. With no job type registered yet, nothing calls these functions; the jobs tests and the type check are what this card proves.

Device check (with M18 or M19 merged on a test branch, or a scratch dev button that calls `startJob` for a `practice` job with a few lines of text; run once Xcode is installed):
1. Start a job, leave the app: the `job_ready` notification opens the job screen; the result is saved and `GET /v1/jobs/:id` answers 404 afterwards (deleted).
2. Start a job and kill the app at once; reopen after a minute: the job is picked up and finishes.
3. Cancel a running job: "Cancelled · nothing charged"; the wallet balance is unchanged.
4. With 0 credits: the job does not start; "Out of credits"; after buying, "Try again" runs it with the same key (one `jobs` row on the server).
5. `sent_log` has the request body before the job starts and the credits after it ends.

Not in this PR: any job type's start screen or saver (M18, M19, M23–M25).

---
### M18 · Second transcript: upload the parts, show the changed words

Branch `pr/m18-second-transcript`. After M34 (and so M15). No new dependencies. Files, all under `apps/mobile/`:
- `src/core/capture/second.ts`, `test/second.test.ts` (new);
- `src/platform/second.ts` (new), `src/platform/jobKinds.ts` (one import line);
- `src/features/capture/SecondTranscriptSheet.tsx` (new), `src/app/second-transcript.tsx` (new), `src/app/_layout.tsx` (one screen line, `presentation: "formSheet"`), `src/features/capture/SessionScreen.tsx` (one menu item, the transcript switch), `src/features/settings/SettingsScreen.tsx` (one switch row), `src/features/capture/useRecording.ts` (one line after saving).

Why it looks like this (`docs/architecture.md` flow 3; PR 23):
- **Audio leaves the phone** only here, for this one job, and is deleted when the job ends. The sheet says so in its first line, before the price. Off by default.
- "Always" in the outline is a Settings switch, **"Offer after each recording"**: when on, the sheet opens after a recording is saved. It never sends without a tap, because every send costs credits (stage 2 rule 5). The owner may want true automatic sending; that is one line in `useRecording.ts` (open question in section 9).
- **Price**: 1 credit per started minute of audio; the quote's `minutes` is the parts' total, rounded up (`audioMinutes`). The server settles per started minute uploaded, never above the quote, and skips parts past the quoted minutes (`truncated`).
- **Upload**: each recording part (AAC `.m4a`, at most 5 minutes, about 2.4 MB at M5's 64 kbit/s) is chunk `n`, in position order, with `PUT /v1/jobs/:id/audio/:n` (session only, raw bytes, at most 4 MiB), then `POST /v1/jobs/:id/audio/done`. Progress is kept in the job's `detail`, so a closed app continues with the next part (`BEFORE_FOLLOW`).
- **Result**: Whisper's segments, with times from the start of each chunk; adding each part's start gives session times. They replace the session's `segments` with `source = 'cloud'` (the device transcript is never changed).
- **Changed words**: a longest-common-subsequence diff of word keys (lowercase letters, digits, apostrophes), one recording part at a time so memory stays small; cloud words that are not in the device transcript are marked.

`src/core/capture/second.ts`, exactly:

```ts
import type { RetranscribeResult } from "@waypoint/contracts";
import type { SqlDb } from "../db/sql.ts";

// A recording part as the second transcript uploads it: chunk n is the n-th audio capture in position order.
export type UploadPart = { n: number; file: string; startMs: number; durationMs: number };

export function uploadParts(db: SqlDb, sessionId: string): UploadPart[] {
  return db
    .all<{ file: string; t: number; duration_ms: number | null }>(
      "SELECT file, t, duration_ms FROM captures WHERE session_id = ? AND kind = 'audio' ORDER BY position, id",
      [sessionId],
    )
    .map((row, n) => ({ n, file: row.file, startMs: row.t, durationMs: row.duration_ms ?? 0 }));
}

// The quote's minutes: every started minute of audio, at least 1 (the server settles per started minute, PR 23).
export function audioMinutes(parts: UploadPart[]): number {
  const ms = parts.reduce((sum, p) => sum + Math.max(0, p.durationMs), 0);
  return Math.max(1, Math.ceil(ms / 60_000));
}

// Replaces the session's cloud segments with the job's result. Whisper's times are seconds from the start of each
// chunk; the part's own start is added. Returns how many segments were written.
export function saveCloudTranscript(db: SqlDb, sessionId: string, parts: UploadPart[], result: RetranscribeResult): number {
  const start = new Map(parts.map((p) => [p.n, p.startMs]));
  const rows: { tStart: number; tEnd: number; text: string }[] = [];
  for (const chunk of result.chunks) {
    const base = start.get(chunk.n);
    if (base === undefined) continue;
    const pieces = chunk.segments.length > 0 ? chunk.segments : [{ start: 0, end: chunk.duration ?? 0, text: chunk.text }];
    for (const s of pieces) {
      const text = s.text.trim();
      if (text === "") continue;
      const tStart = base + Math.round(s.start * 1000);
      rows.push({ tStart, tEnd: Math.max(tStart, base + Math.round(s.end * 1000)), text });
    }
  }
  db.transaction(() => {
    db.run("DELETE FROM segments WHERE session_id = ? AND source = 'cloud'", [sessionId]);
    for (const r of rows) {
      db.run("INSERT OR IGNORE INTO segments (session_id, t_start, t_end, text, source) VALUES (?, ?, ?, ?, 'cloud')", [sessionId, r.tStart, r.tEnd, r.text]);
    }
  });
  return rows.length;
}

export type DiffWord = { text: string; changed: boolean };
export const MAX_DIFF_CELLS = 4_000_000;

// Lowercase letters and digits only, so "Mitochondria," and "mitochondria" are the same word.
function key(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9']/g, "");
}

// The cloud words with the ones that differ from the device's marked, from a longest common subsequence of word
// keys. O(a·b) memory, so callers diff one recording part (about 750 words) at a time. Counts above 65,535 cannot
// happen below MAX_DIFF_CELLS.
export function diffWords(device: string, cloud: string): DiffWord[] {
  const a = device.split(/\s+/).filter((w) => w !== "");
  const b = cloud.split(/\s+/).filter((w) => w !== "");
  const ka = a.map(key);
  const kb = b.map(key);
  // Too big to compare in memory (a part far longer than 5 minutes): show the cloud words unmarked.
  if ((ka.length + 1) * (kb.length + 1) > MAX_DIFF_CELLS) return b.map((text) => ({ text, changed: false }));
  const width = kb.length + 1;
  const lcs = new Uint16Array((ka.length + 1) * width);
  for (let i = ka.length - 1; i >= 0; i--) {
    for (let j = kb.length - 1; j >= 0; j--) {
      lcs[i * width + j] = ka[i] === kb[j] ? (lcs[(i + 1) * width + j + 1] ?? 0) + 1 : Math.max(lcs[(i + 1) * width + j] ?? 0, lcs[i * width + j + 1] ?? 0);
    }
  }
  const out: DiffWord[] = [];
  let i = 0;
  let j = 0;
  while (j < kb.length) {
    if (i < ka.length && ka[i] === kb[j]) {
      out.push({ text: b[j] ?? "", changed: false });
      i++;
      j++;
    } else if (i < ka.length && (lcs[(i + 1) * width + j] ?? 0) >= (lcs[i * width + j + 1] ?? 0)) {
      i++;
    } else {
      out.push({ text: b[j] ?? "", changed: true });
      j++;
    }
  }
  return out;
}

// Both transcripts of one part: the segments that start inside [startMs, startMs + durationMs).
export function partText(db: SqlDb, sessionId: string, source: "device" | "cloud", part: { startMs: number; durationMs: number }): string {
  return db
    .all<{ text: string }>(
      "SELECT text FROM segments WHERE session_id = ? AND source = ? AND t_start >= ? AND t_start < ? ORDER BY t_start",
      [sessionId, source, part.startMs, part.startMs + Math.max(1, part.durationMs)],
    )
    .map((r) => r.text)
    .join(" ");
}

// Settings key: "1" when every new recording should be offered a second transcript right after it is saved.
export const SECOND_ALWAYS_KEY = "second_transcript_always";
```

`test/second.test.ts`, exactly:

```ts
import { describe, expect, it } from "vitest";
import { audioMinutes, diffWords, partText, saveCloudTranscript, uploadParts } from "../src/core/capture/second.ts";
import { savePart, saveSegment, startRecordingSession } from "../src/core/capture/recording.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import { createMemoryDb } from "./helpers/db.ts";

function setup() {
  const db = createMemoryDb();
  migrate(db);
  let n = 0;
  const deps = { now: () => 1000, newId: () => `id_${++n}` };
  const space = ensureDefaultSpace(db, deps);
  const session = startRecordingSession(db, deps, space.id, true);
  savePart(db, deps, session.id, { index: 1, startMs: 300_000, durationMs: 90_500, file: "b.m4a" });
  savePart(db, deps, session.id, { index: 0, startMs: 0, durationMs: 300_000, file: "a.m4a" });
  return { db, session };
}

describe("second transcript", () => {
  it("parts in position order, minutes rounded up", () => {
    const { db, session } = setup();
    const parts = uploadParts(db, session.id);
    expect(parts.map((p) => [p.n, p.file, p.startMs])).toEqual([[0, "a.m4a", 0], [1, "b.m4a", 300_000]]);
    expect(audioMinutes(parts)).toBe(7);
    expect(audioMinutes([])).toBe(1);
  });
  it("cloud segments replace earlier ones, offset by each part's start", () => {
    const { db, session } = setup();
    const parts = uploadParts(db, session.id);
    const result = {
      v: 1 as const,
      truncated: false,
      chunks: [
        { n: 1, duration: 90.5, text: "b", segments: [{ start: 1.5, end: 3, text: " the cell " }] },
        { n: 0, duration: 300, text: "a whole", segments: [] },
        { n: 9, duration: 1, text: "ignored", segments: [] },
      ],
    };
    expect(saveCloudTranscript(db, session.id, parts, result)).toBe(2);
    expect(saveCloudTranscript(db, session.id, parts, result)).toBe(2);
    const rows = db.all<{ t_start: number; t_end: number; text: string }>("SELECT t_start, t_end, text FROM segments WHERE source = 'cloud' ORDER BY t_start");
    expect(rows).toEqual([{ t_start: 0, t_end: 300_000, text: "a whole" }, { t_start: 301_500, t_end: 303_000, text: "the cell" }]);
  });
  it("diffWords marks cloud words the device did not have", () => {
    expect(diffWords("the my toe Condria is", "The mitochondria is,")).toEqual([
      { text: "The", changed: false },
      { text: "mitochondria", changed: true },
      { text: "is,", changed: false },
    ]);
    expect(diffWords("", "new words")).toEqual([{ text: "new", changed: true }, { text: "words", changed: true }]);
    expect(diffWords("same", "")).toEqual([]);
    const long = Array.from({ length: 2100 }, (_, i) => `w${i}`).join(" ");
    expect(diffWords(long, long + " extra").every((w) => !w.changed)).toBe(true);
  });
  it("partText reads one part of one source", () => {
    const { db, session } = setup();
    saveSegment(db, session.id, { tStart: 10, tEnd: 20, text: "one" });
    saveSegment(db, session.id, { tStart: 299_999, tEnd: 300_100, text: "two" });
    saveSegment(db, session.id, { tStart: 300_000, tEnd: 300_100, text: "three" });
    expect(partText(db, session.id, "device", { startMs: 0, durationMs: 300_000 })).toBe("one two");
  });
});
```

`src/platform/second.ts`, exactly:

```ts
import { File, Paths } from "expo-file-system";
import { MAX_AUDIO_CHUNK_BYTES, RetranscribeResultSchema } from "@waypoint/contracts";
import type { CloudFailure } from "../core/cloud/failure.ts";
import { audioMinutes, saveCloudTranscript, uploadParts } from "../core/capture/second.ts";
import { setDetail, type LocalJob } from "../core/jobs/jobs.ts";
import { api } from "./api.ts";
import { getDb, writeDb } from "./db.ts";
import { startJob } from "./jobs.ts";
import { BEFORE_FOLLOW, RESULT_ROUTES, RESULT_SAVERS } from "./jobResults.ts";

// The most the server takes (QuoteRequestSchema: minutes ≤ 600; MAX_AUDIO_CHUNKS: 200 parts).
export const MAX_SECOND_MINUTES = 600;

export type SecondPlan = { minutes: number; parts: number; bytes: number } | null;

// What a second transcript of this session would send. null: no audio parts.
export function secondPlan(sessionId: string): SecondPlan {
  const parts = uploadParts(getDb(), sessionId);
  if (parts.length === 0) return null;
  const bytes = parts.reduce((sum, p) => sum + new File(Paths.document, p.file).size, 0);
  return { minutes: audioMinutes(parts), parts: parts.length, bytes };
}

// key: made when the sheet opened; the same key on "Try again" after Out of credits.
export async function startSecondTranscript(sessionId: string, key: string): Promise<{ ok: true; jobId: string } | { ok: false; failure: CloudFailure }> {
  const plan = secondPlan(sessionId);
  if (plan === null || plan.minutes > MAX_SECOND_MINUTES) return { ok: false, failure: { kind: "failed" } };
  return startJob({
    request: { type: "retranscribe", minutes: plan.minutes },
    key,
    sessionId,
    detail: { parts: plan.parts, uploaded: 0, done: false },
    sent: { type: "retranscribe", minutes: plan.minutes, parts: plan.parts, audio_bytes: plan.bytes },
  });
}

function progress(job: LocalJob): { uploaded: number; done: boolean } {
  try {
    const d = JSON.parse(job.detail) as { uploaded?: unknown; done?: unknown };
    return { uploaded: typeof d.uploaded === "number" ? d.uploaded : 0, done: d.done === true };
  } catch {
    return { uploaded: 0, done: false };
  }
}

// Uploads the parts not sent yet, then says it is done (PR 23). Runs before every follow of a retranscribe job, so an
// upload cut off by the app closing goes on from the next part.
async function uploadRest(job: LocalJob): Promise<void> {
  const { uploaded, done } = progress(job);
  if (done || job.state !== "queued" || job.sessionId === null) return;
  const parts = uploadParts(getDb(), job.sessionId);
  for (let n = uploaded; n < parts.length; n++) {
    const part = parts[n];
    if (part === undefined) break;
    const bytes = await new File(Paths.document, part.file).bytes();
    if (bytes.length === 0 || bytes.length > MAX_AUDIO_CHUNK_BYTES) {
      await api.deleteJob(job.id); // nothing is charged; the job screen shows it cancelled
      throw new Error("audio part missing or too large");
    }
    await api.uploadAudio(job.id, n, bytes);
    writeDb((db) => setDetail(db, job.id, { uploaded: n + 1 }, Date.now()));
  }
  await api.audioDone(job.id, parts.length);
  writeDb((db) => setDetail(db, job.id, { done: true }, Date.now()));
}

BEFORE_FOLLOW.retranscribe = uploadRest;
RESULT_SAVERS.retranscribe = (db, job, text) => {
  const result = RetranscribeResultSchema.parse(JSON.parse(text));
  if (job.sessionId === null) return;
  saveCloudTranscript(db, job.sessionId, uploadParts(db, job.sessionId), result);
  setDetail(db, job.id, { truncated: result.truncated }, Date.now());
};
RESULT_ROUTES.retranscribe = (job) => (job.sessionId === null ? "/jobs" : `/session/${job.sessionId}?view=second`);
```

`src/platform/jobKinds.ts`: add `import "./second.ts";`.

Screens (copy written for this card; check it against the boards):
- **`SecondTranscriptSheet`** (`/second-transcript?sessionId=`), a form sheet. First line, bold: "Your recording's audio will be sent to Waypoint's cloud for this one job, and deleted when it ends." Then body "A second, more careful transcript. Words that differ from this iPhone's transcript are highlighted." Then `QuoteBox` with `useQuote({ task: "retranscribe", minutes: plan.minutes })` and `onShowSent` showing an `Alert` with "`minutes` minutes of audio in `parts` parts (`size` MB)." The key is made once when the sheet opens (`randomUUID()`, kept in a ref). Button "Send audio · `credits` credits" → `startSecondTranscript(sessionId, key)`: ok → close and `router.push(`/job/${jobId}`)`; a failure shows `failureCopy` with its actions (Get credits → `/plans?need=N`, then the same key). When `secondPlan` is null: "This session has no recording." Over 600 minutes: "This recording is too long for a second transcript."
- **`SessionScreen`**: the "More" menu (`Alert` in `openMenu`) gains "Second transcript" for a recording session in state `saved` or `interrupted` → `/second-transcript?sessionId=…`. When the session has cloud segments, the transcript section (added by M15) gets a two-way switch "On this iPhone" / "Second transcript" (route param `view=second` selects the second). The second view lists, for each part of `uploadParts`, `diffWords(partText(…, "device", part), partText(…, "cloud", part))` as wrapped text with changed words on `accentSoft` with bold weight, and the caption "Highlighted words are different from this iPhone's transcript." When the job's `detail.truncated` is true: caption "Only the minutes you paid for were transcribed."
- **`SettingsScreen`**: under ON THIS IPHONE, a switch row "Offer a second transcript after each recording" (setting `SECOND_ALWAYS_KEY`, `"1"` or absent). `useRecording.ts`: after a recording is saved, when the setting is `"1"`, `router.push(`/second-transcript?sessionId=${id}`)`.

Checks without Xcode: root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.

Device check (run once Xcode is installed; the API with PR 23 and Workers Paid):
1. Record 6 minutes; Second transcript: the sheet's first line is the audio sentence; the quote is 6 credits.
2. Send: R2 `tmp/audio/<job>/0` and `/1` appear, then disappear when the job ends; the job screen goes to Ready; the session shows the switch; changed words are highlighted.
3. Kill the app during the upload of part 1; reopen: the upload continues from part 1 and the job finishes.
4. Airplane Mode during the upload: it waits and continues when back online (`NetworkError` backoff).
5. `sent_log` shows `{"type":"retranscribe","minutes":6,"parts":2,"audio_bytes":…}`; Cloud activity (M21, if merged) matches it.

Not in this PR: changing the device transcript from the cloud one; a cloud-transcript-only search index (the indexer keeps using the device transcript).

---
### M19 · Research the web: question, depth, result, sources (no remote images)

Branch `pr/m19-research`. After M34 (and so M15); the Explain entry needs M16 (merge after it). Dependency: `expo-web-browser` **58.0.7** (published 2026-10-27; SDK 58's `bundledNativeModules.json` asks for `~58.0.7`), for opening sources in the in-app browser (`SFSafariViewController`). Files, all under `apps/mobile/`:
- `package.json` (one dependency), `src/core/db/schema.ts` (migration 4), `test/migrate.test.ts` (3 → 4);
- `src/core/research/answer.ts`, `src/core/research/research.ts`, `test/answer.test.ts`, `test/research.test.ts` (new);
- `src/platform/research.ts` (new), `src/platform/jobKinds.ts` (one import line);
- `src/features/research/NewResearchScreen.tsx`, `src/features/research/ResearchScreen.tsx` (new), `src/app/research/new.tsx`, `src/app/research/[id].tsx` (new), `src/app/_layout.tsx` (two screen lines);
- `src/features/capture/SessionScreen.tsx` (one button), `src/features/explain/ExplainSheet.tsx` (one button, M16's file).

Why it looks like this (D10–D12; PR 24; hardening note for M19):
- Started from a session ("Research the web") or from an Explain answer whose `offer_research` is true (the word becomes the question's start: "What is `word`?", editable).
- Depth quick, standard or deep (15, 45 or 125 credits, from the quote). The question is at most 500 characters. **"Include my notes from this session"** is off by default; when on, the session's transcript and page text, cut at 8,000 characters, are sent too, and "Show what's sent" shows exactly that text first.
- The answer is Markdown citing sources as `[n]`. It is shown as plain text blocks. **No remote image or resource is ever loaded** (a page the research read could make the writer emit an image URL carrying the notes): images become "(image: alt text)", links become "text (host)", and only the sources list opens pages, on a tap, in the in-app browser, `http`/`https` only.

`src/core/db/schema.ts`: append to `MIGRATIONS`, exactly:

```ts
  {
    version: 4,
    sql: `
CREATE TABLE research (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions (id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  depth TEXT NOT NULL CHECK (depth IN ('quick', 'standard', 'deep')),
  answer TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX research_session ON research (session_id, created_at);
`,
  },
```

`src/core/research/answer.ts`, exactly:

```ts
// A research answer is Markdown that cites sources as [n] (PR 24). It is shown as plain text blocks: no HTML, no
// remote images (an image URL could carry the notes to someone else's server, hardening note for M19), and links
// only as text with their host.
export type Inline = { kind: "text"; text: string } | { kind: "cite"; n: number };
export type Block = { kind: "heading" | "paragraph" | "bullet"; parts: Inline[] };

function host(url: string): string {
  const match = /^https?:\/\/([^/?#\s]+)/i.exec(url.trim());
  return match?.[1]?.toLowerCase() ?? "link";
}

// One line's inline Markdown: images become "(image: alt)", links "text (host)", emphasis marks are dropped, and
// [n] becomes a citation when n is one of the sources.
export function inlineParts(line: string, sources: ReadonlySet<number>): Inline[] {
  const text = line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => (alt.trim() === "" ? "(image)" : `(image: ${alt.trim()})`))
    .replace(/\[([^\]]+)\]\(([^)\s]*)[^)]*\)/g, (_m, label: string, url: string) => `${label} (${host(url)})`)
    .replace(/(\*\*|__|`)/g, "")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2");
  const out: Inline[] = [];
  let rest = text;
  const cite = /\[(\d{1,3})\]/;
  for (let m = cite.exec(rest); m !== null; m = cite.exec(rest)) {
    const n = Number(m[1]);
    const before = rest.slice(0, m.index);
    if (sources.has(n)) {
      if (before !== "") out.push({ kind: "text", text: before });
      out.push({ kind: "cite", n });
    } else {
      out.push({ kind: "text", text: before + m[0] });
    }
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest !== "") out.push({ kind: "text", text: rest });
  // Join neighbouring text parts.
  return out.reduce<Inline[]>((acc, part) => {
    const last = acc[acc.length - 1];
    if (part.kind === "text" && last !== undefined && last.kind === "text") acc[acc.length - 1] = { kind: "text", text: last.text + part.text };
    else acc.push(part);
    return acc;
  }, []);
}

export function answerBlocks(markdown: string, sourceNumbers: number[]): Block[] {
  const sources = new Set(sourceNumbers);
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", parts: inlineParts(paragraph.join(" "), sources) });
    paragraph = [];
  };
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("```") || /^[-*_]{3,}$/.test(line)) {
      flush();
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^(?:[-*+]|\d{1,3}[.)])\s+(.*)$/.exec(line);
    if (heading !== null) {
      flush();
      blocks.push({ kind: "heading", parts: inlineParts(heading[1] ?? "", sources) });
    } else if (bullet !== null) {
      flush();
      blocks.push({ kind: "bullet", parts: inlineParts(bullet[1] ?? "", sources) });
    } else {
      paragraph.push(line.replace(/^>\s?/, ""));
    }
  }
  flush();
  return blocks;
}

// Only http and https sources open, in the in-app browser.
export function openableUrl(url: string): string | null {
  return /^https?:\/\/[^\s]+$/i.test(url.trim()) ? url.trim() : null;
}
```

`src/core/research/research.ts`, exactly:

```ts
import { JOB_TEXT_MAX_CHARS, ResearchResultSchema, type ResearchDepth } from "@waypoint/contracts";
import type { SqlDb } from "../db/sql.ts";

export type ResearchItem = {
  id: string; // the job id
  sessionId: string | null;
  question: string;
  depth: ResearchDepth;
  answer: string;
  sources: { n: number; url: string; title: string }[];
  createdAt: number;
};

type Row = { id: string; session_id: string | null; question: string; depth: ResearchDepth; answer: string; sources: string; created_at: number };

function fromRow(r: Row): ResearchItem {
  const sources = ResearchResultSchema.shape.sources.safeParse(JSON.parse(r.sources));
  return { id: r.id, sessionId: r.session_id, question: r.question, depth: r.depth, answer: r.answer, sources: sources.success ? sources.data : [], createdAt: r.created_at };
}

// The opened result of a research job (RESULT_SAVERS). Throws on a result that is not ResearchResultSchema.
export function saveResearch(db: SqlDb, job: { id: string; sessionId: string | null; detail: string }, text: string, now: number): void {
  const result = ResearchResultSchema.parse(JSON.parse(text));
  const detail = JSON.parse(job.detail) as { question?: unknown; depth?: unknown };
  const question = typeof detail.question === "string" ? detail.question : "";
  const depth = detail.depth === "standard" || detail.depth === "deep" ? detail.depth : "quick";
  db.run(
    "INSERT OR REPLACE INTO research (id, session_id, question, depth, answer, sources, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [job.id, job.sessionId, question, depth, result.answer, JSON.stringify(result.sources), now],
  );
}

export function getResearch(db: SqlDb, id: string): ResearchItem | null {
  const row = db.get<Row>("SELECT id, session_id, question, depth, answer, sources, created_at FROM research WHERE id = ?", [id]);
  return row === null ? null : fromRow(row);
}

export function researchForSession(db: SqlDb, sessionId: string): ResearchItem[] {
  return db
    .all<Row>("SELECT id, session_id, question, depth, answer, sources, created_at FROM research WHERE session_id = ? ORDER BY created_at DESC", [sessionId])
    .map(fromRow);
}

// The session's own words, for "Include my notes": the transcript made on this iPhone, then page text, cut at a word
// boundary to the research cap (8,000 characters). Shown in full before it is sent.
export function notesForResearch(db: SqlDb, sessionId: string, max: number = JOB_TEXT_MAX_CHARS.research): string {
  const transcript = db
    .all<{ text: string }>("SELECT text FROM segments WHERE session_id = ? AND source = 'device' ORDER BY t_start", [sessionId])
    .map((r) => r.text);
  const pages = db
    .all<{ found_text: string | null }>("SELECT found_text FROM captures WHERE session_id = ? AND kind IN ('page', 'photo') ORDER BY position, t", [sessionId])
    .map((r) => r.found_text ?? "");
  const text = [...transcript, ...pages].join(" ").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return space > 0 ? cut.slice(0, space) : cut;
}
```

`test/answer.test.ts`, exactly:

```ts
import { describe, expect, it } from "vitest";
import { answerBlocks, inlineParts, openableUrl } from "../src/core/research/answer.ts";

describe("research answer", () => {
  it("never keeps an image or link URL, and keeps citations for known sources", () => {
    expect(inlineParts("Cells ![x](https://evil.test/?notes=abc) divide [1][7] see [the page](https://www.nih.gov/a) **now**", new Set([1]))).toEqual([
      { kind: "text", text: "Cells (image: x) divide " },
      { kind: "cite", n: 1 },
      { kind: "text", text: "[7] see the page (www.nih.gov) now" },
    ]);
  });
  it("blocks: headings, bullets, paragraphs joined across lines", () => {
    const md = "# Mitosis\nCells split\ninto two. [2]\n\n- one\n2. two\n```\ncode\n```\n> quoted";
    expect(answerBlocks(md, [2]).map((b) => [b.kind, b.parts.map((p) => (p.kind === "text" ? p.text : `#${p.n}`)).join("")])).toEqual([
      ["heading", "Mitosis"],
      ["paragraph", "Cells split into two. #2"],
      ["bullet", "one"],
      ["bullet", "two"],
      ["paragraph", "code"],
      ["paragraph", "quoted"],
    ]);
  });
  it("emphasis is dropped, words with underscores are kept", () => {
    expect(inlineParts("an *important* snake_case word", new Set())).toEqual([{ kind: "text", text: "an important snake_case word" }]);
  });
  it("openableUrl", () => {
    expect(openableUrl("https://a.test/x")).toBe("https://a.test/x");
    expect(openableUrl("javascript:alert(1)")).toBeNull();
    expect(openableUrl("data:text/html,x")).toBeNull();
  });
});
```

`test/research.test.ts`, exactly:

```ts
import { describe, expect, it } from "vitest";
import { savePart, saveSegment, startRecordingSession } from "../src/core/capture/recording.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import { getResearch, notesForResearch, researchForSession, saveResearch } from "../src/core/research/research.ts";
import { createMemoryDb } from "./helpers/db.ts";

function setup() {
  const db = createMemoryDb();
  migrate(db);
  let n = 0;
  const deps = { now: () => 1000, newId: () => `id_${++n}` };
  const session = startRecordingSession(db, deps, ensureDefaultSpace(db, deps).id, true);
  return { db, session };
}
const RESULT = JSON.stringify({ v: 1, answer: "Cells divide [1].", sources: [{ n: 1, url: "https://a.test", title: "A" }] });

describe("research", () => {
  it("saves and reads a result with its question", () => {
    const { db, session } = setup();
    saveResearch(db, { id: "job_1", sessionId: session.id, detail: '{"question":"Why?","depth":"deep"}' }, RESULT, 5);
    expect(getResearch(db, "job_1")).toEqual({ id: "job_1", sessionId: session.id, question: "Why?", depth: "deep", answer: "Cells divide [1].", sources: [{ n: 1, url: "https://a.test", title: "A" }], createdAt: 5 });
    expect(researchForSession(db, session.id)).toHaveLength(1);
  });
  it("a result that is not the contract throws, and nothing is saved", () => {
    const { db } = setup();
    expect(() => saveResearch(db, { id: "job_2", sessionId: null, detail: "{}" }, '{"v":1}', 5)).toThrow();
    expect(getResearch(db, "job_2")).toBeNull();
  });
  it("deleting the session deletes its research", () => {
    const { db, session } = setup();
    saveResearch(db, { id: "job_1", sessionId: session.id, detail: "{}" }, RESULT, 5);
    db.run("DELETE FROM sessions WHERE id = ?", [session.id]);
    expect(getResearch(db, "job_1")).toBeNull();
  });
  it("notesForResearch: transcript then pages, cut at a word", () => {
    const { db, session } = setup();
    saveSegment(db, session.id, { tStart: 0, tEnd: 1, text: "alpha beta" });
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file, found_text) VALUES ('c1', ?, 'page', 0, 0, 'p.jpg', 'gamma delta')", [session.id]);
    expect(notesForResearch(db, session.id)).toBe("alpha beta gamma delta");
    expect(notesForResearch(db, session.id, 13)).toBe("alpha beta");
  });
});
```

`src/platform/research.ts`:

```ts
import { openBrowserAsync } from "expo-web-browser";
import type { ResearchDepth } from "@waypoint/contracts";
import type { CloudFailure } from "../core/cloud/failure.ts";
import { openableUrl } from "../core/research/answer.ts";
import { saveResearch } from "../core/research/research.ts";
import { RESULT_ROUTES, RESULT_SAVERS } from "./jobResults.ts";
import { startJob } from "./jobs.ts";

export function startResearch(input: { question: string; depth: ResearchDepth; notes: string | null; sessionId: string | null; key: string }): Promise<{ ok: true; jobId: string } | { ok: false; failure: CloudFailure }> {
  const request = input.notes === null || input.notes === ""
    ? { type: "research" as const, depth: input.depth, question: input.question }
    : { type: "research" as const, depth: input.depth, question: input.question, text: input.notes };
  return startJob({ request, key: input.key, sessionId: input.sessionId, detail: { question: input.question, depth: input.depth } });
}

export async function openSource(url: string): Promise<void> {
  const safe = openableUrl(url);
  if (safe !== null) await openBrowserAsync(safe);
}

RESULT_SAVERS.research = (db, job, text) => saveResearch(db, job, text, Date.now());
RESULT_ROUTES.research = (job) => `/research/${job.id}`;
```

`src/platform/jobKinds.ts`: add `import "./research.ts";`.

Screens (copy written for this card; check it against D10–D12):
- **`NewResearchScreen`** (`/research/new?sessionId=&q=`): title "Research the web". A multiline field "Your question" (prefilled from `q`, max 500, counter "`n`/500"). Three choices "Quick", "Standard", "Deep" (`Row` with `selected`), subtitles "A short answer from a few pages", "A fuller answer from more pages", "A careful answer from many pages". When opened from a session: a switch "Include my notes from this session" (off) and, when on, "Show what's sent" shows `notesForResearch(db, sessionId)` in a scrollable sheet. `QuoteBox` with `useQuote({ task: "research", depth })`. Button "Research · `credits` credits" → `startResearch(...)` with a key made when the screen opened → `/job/<id>`. Failures as in M34.
- **`ResearchScreen`** (`/research/[id]`): the question as the title, `answerBlocks(item.answer, item.sources.map((s) => s.n))` rendered with `Text` only (heading bold, bullet with "•", a citation as a small accent "[n]" that scrolls to the source), then "SOURCES": one `Row` per source, title the source's `title` (or its host), subtitle the host, pressing → `openSource(url)`. Caption "Sent for this task only. Pages were read by Waypoint's cloud."
- **`SessionScreen`**: a `SecondaryButton` "Research the web" (icon `globe`) under the study buttons → `/research/new?sessionId=…`; and a "RESEARCH" list of `researchForSession` rows opening `/research/<id>`.
- **`ExplainSheet`** (M16): when the answer's `offer_research` is true, a text button "Research this on the web" → `/research/new?sessionId=…&q=` with "What is `word`?".

Checks without Xcode: root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.

Device check (run once Xcode is installed; the API with PR 24 and H1):
1. From a session, Quick research without notes: the request body in `sent_log` has no `text`; the job finishes; the answer shows with citations; tapping a source opens it in the in-app browser.
2. With "Include my notes": "Show what's sent" shows the same text as `sent_log`'s body.
3. A result whose answer contains `![x](https://example.com/a.png)` (edit the saved row in a debug build) shows "(image: x)" and makes no request to example.com (watch the network in the Xcode console or a proxy).
4. From Explain with `offer_research` true: the question is prefilled.

Not in this PR: "Read a link" (PR 26, price undecided); saving research to flashcards.

---
## 5. Stage 3: voices, overviews, practice, diagrams and mini apps

### M22a · Spike (time-boxed, 2 days): Kokoro-82M on the iPhone with an English phonemizer

Branch `spike/m22a-kokoro`. **Not merged**: the branch and its pull request hold the code and the report; the pull request is closed after the owner reads it. Needs Xcode 27.2, the build Mac on Tahoe 26.6, and two iPhones: the oldest one iOS 26 supports that the owner can borrow (iPhone 11 or 12, 4 GB of memory) and one recent one. Run once Xcode is installed.

Why a spike: Kokoro takes phonemes, not text, so it needs an English grapheme-to-phoneme step on the phone; its usual tools are Python and espeak-ng (GPL-3.0, which cannot ship in this App Store app). Open question 51.

What is known (checked 19 Nov 2026; links in the PR):
- **FluidAudio** (github.com/FluidInference/FluidAudio, Apache-2.0, weights `FluidInference/kokoro-82m-coreml` Apache-2.0) runs Kokoro as Core ML stages on CPU, Neural Engine and GPU, with a Swift English front end: custom lexicon, then the misaki lexicon, then rules, then a small Core ML G2P model for unknown words. No GPL code on its main branch. It ships a CocoaPods podspec (iOS 17; its Kokoro runtime needs iOS 18). It publishes Mac numbers only; its iPhone path is "unvalidated". Use **v0.18.2** (released 2026-11-01; newer tags are under 14 days old).
- **mattmireles/kokoro-coreml** (Apache-2.0, SwiftPM only) publishes iPhone 12 Pro numbers (3 s of speech in 98 ms, 61 MB; 15 s in 261 ms, 500 MB), but its G2P fallback pulls in MLX (GPU), which iOS does not allow in the background.
- Voices: `af_heart` (best rated) for host A and `am_michael` for host B (Kokoro's male American voices are rated C+; listen and pick).

Time box: **2 working days**. Stop when the box ends, whatever state.

Steps:
1. A scratch local module `apps/mobile/modules/voices-spike` with a podspec that adds `s.dependency 'FluidAudio', '0.18.2'` (check first with `pod spec cat FluidAudio --version=0.18.2`; if it is not on CocoaPods trunk, add it as a local pod from a git checkout of the tag). One async function `speak(text, voice) → { file, ms, peakMB }` and a dev screen under `src/app/dev/`.
2. Find out whether FluidAudio can load its models **from a folder the app provides** (we download a pack from our R2 and check its SHA-256, `docs/architecture.md` "Voice pack"); it must not fetch from Hugging Face at run time. If it cannot, note what it would take (a fork or a patch) — that is a no-go unless small.
3. Measure on both phones, release build, after a cold start: (a) first load including Core ML compilation, (b) a later load, (c) time to first audio for a 15-word sentence including G2P, (d) speed over a 2-minute passage (seconds of audio per second of compute), (e) peak memory (Xcode memory gauge / Instruments), (f) whether the Neural Engine is used (Instruments, Core ML template), (g) whether rendering continues with the screen locked, (h) thermal state after 10 minutes.
4. Pronunciation: the 200-line list of K-12 sentences in the PR (science and history terms, names, numbers, abbreviations, heteronyms such as "read" and "lead"). Count mispronounced words by listening; try fixing three with FluidAudio's custom lexicon.
5. Licenses: list every component the pod brings in, with its license.
6. Only if FluidAudio fails steps 2–3 and a day is left: the same measurements with mattmireles/kokoro-coreml.

**Go** only if, on the 4 GB phone: first load ≤ 20 s and later loads ≤ 2 s; first audio ≤ 500 ms; at least 3× real time; peak memory ≤ 450 MB and no memory kill during a 20-minute render with the app's screens open; ≤ 2 % mispronounced words, and the custom lexicon fixes a word; the model download ≤ 200 MB; models load from our own folder; no GPL code. Rendering may need the app in the foreground (the overview screen says "Keep Waypoint open while the voices are made"); record whether it does.

Report (the PR description): the numbers for each phone, the go or no-go with the reasons, the model files with sizes and SHA-256, the exact FluidAudio API calls used, and what M22c (the Kokoro engine) must contain. **If no-go:** Waypoint ships Apple's voices only (M22b); the voice pack in `GET /v1/config` stays a placeholder; the cloud fallback voice (`fallback_voice`, MeloTTS) stays unbuilt (open question 36). Write the decision into `docs/build-plan.md` (open question 51) in a docs pull request.

---

### M22b · Native module `waypoint-voices`: render a two-voice script to an audio file (Apple's voices)

Branch `pr/m22b-voices`. After M22a's report (the module is needed either way; the Kokoro engine is M22c, written from the report if it says go). No new npm dependencies. Files, all under `apps/mobile/`:
- `modules/waypoint-voices/expo-module.config.json`, `index.ts`, `src/WaypointVoices.ts`, `ios/WaypointVoices.podspec`, `ios/WaypointVoicesModule.swift`, `ios/ScriptRenderer.swift` (new);
- `modules/waypoint-voices/ios/Core/VoicePick.swift`, `ios/Tests/VoicePickTests.swift` (new); `modules/Package.swift` (two targets: `VoicesCore` and `VoicesCoreTests`, like the existing ones).

Why it looks like this (`docs/architecture.md` section 2: the voices for audio overviews run on the iPhone and are free):
- An overview is rendered once into an `.m4a` file in Documents and then played like any audio; it is not spoken live. That makes it pausable, seekable and playable with the screen locked, and lets M24 put the same narration under a video.
- `AVSpeechSynthesizer.write(_:toBufferCallback:)` gives each line as PCM buffers without playing it. Lines are converted to one format (mono, 24 kHz, Float32) with `AVAudioConverter`, joined with 350 ms of silence, and written with `AVAudioFile` as AAC (`kAudioFormatMPEG4AAC`, 64 kbit/s), matching the recordings.
- Two voices for hosts A and B: the best-quality installed voices for the device's language (falling back to its base language, then en-US), a female and a male one when both exist (`VoicePick`, tested on the Mac). The person can download better ("Enhanced"/"Premium") voices in iOS Settings; the overview screen says where.
- The module returns where each line starts, so the player highlights the line being spoken.

`ios/Core/VoicePick.swift`, exactly:

```swift
import Foundation

// A system voice as AVSpeechSynthesisVoice describes it, without importing AVFoundation (so it is tested on the Mac).
public struct VoiceInfo: Equatable, Sendable {
  public enum Gender: Sendable { case female, male, unspecified }
  public let identifier: String
  public let language: String // BCP 47, for example "en-US"
  public let quality: Int // 1 default, 2 enhanced, 3 premium
  public let gender: Gender
  public init(identifier: String, language: String, quality: Int, gender: Gender) {
    self.identifier = identifier; self.language = language; self.quality = quality; self.gender = gender
  }
}

public enum VoicePick {
  // Two different voices for hosts A and B: same language as wanted (else the same base language, else en-US), best
  // quality first, and a female and a male voice when both exist. nil when no voice fits.
  public static func hosts(from voices: [VoiceInfo], language: String) -> (a: VoiceInfo, b: VoiceInfo)? {
    let base = language.split(separator: "-").first.map(String.init) ?? language
    let candidates = [
      voices.filter { $0.language == language },
      voices.filter { $0.language.hasPrefix(base + "-") || $0.language == base },
      voices.filter { $0.language == "en-US" },
    ].first { $0.count >= 2 } ?? []
    let ranked = candidates.sorted { ($0.quality, $1.identifier) > ($1.quality, $0.identifier) }
    guard let first = ranked.first else { return nil }
    let other = ranked.first { $0.identifier != first.identifier && $0.gender != first.gender && $0.gender != .unspecified && first.gender != .unspecified }
      ?? ranked.first { $0.identifier != first.identifier }
    guard let second = other else { return nil }
    return first.gender == .male && second.gender == .female ? (second, first) : (first, second)
  }
}

// Where each line of a rendered script starts, with a fixed pause between lines.
public enum ScriptTiming {
  public static let pauseMs = 350

  public static func lineStarts(durationsMs: [Int]) -> (starts: [Int], totalMs: Int) {
    var starts: [Int] = []
    var at = 0
    for (i, d) in durationsMs.enumerated() {
      starts.append(at)
      at += max(0, d) + (i == durationsMs.count - 1 ? 0 : pauseMs)
    }
    return (starts, at)
  }
}
```

`ios/Tests/VoicePickTests.swift`, exactly:

```swift
import Testing
@testable import VoicesCore

private func v(_ id: String, _ lang: String, _ q: Int, _ g: VoiceInfo.Gender) -> VoiceInfo { VoiceInfo(identifier: id, language: lang, quality: q, gender: g) }

@Test func picksTheBestFemaleAndMaleVoiceOfTheLanguage() {
  let voices = [v("f1", "en-US", 1, .female), v("f2", "en-US", 3, .female), v("m1", "en-US", 2, .male), v("x", "fr-FR", 3, .male)]
  let pick = VoicePick.hosts(from: voices, language: "en-US")
  #expect(pick?.a.identifier == "f2")
  #expect(pick?.b.identifier == "m1")
}

@Test func fallsBackToTheBaseLanguageThenEnglish() {
  #expect(VoicePick.hosts(from: [v("a", "en-GB", 1, .male), v("b", "en-AU", 1, .female)], language: "en-US")?.a.identifier == "b")
  #expect(VoicePick.hosts(from: [v("a", "en-US", 1, .male), v("b", "en-US", 1, .male)], language: "de-DE") != nil)
  #expect(VoicePick.hosts(from: [v("a", "en-US", 1, .male)], language: "en-US") == nil)
  #expect(VoicePick.hosts(from: [], language: "en-US") == nil)
}

@Test func twoDifferentVoicesEvenWithoutGenders() {
  let pick = VoicePick.hosts(from: [v("a", "en-US", 1, .unspecified), v("b", "en-US", 1, .unspecified)], language: "en-US")
  #expect(pick != nil && pick?.a.identifier != pick?.b.identifier)
}

@Test func lineStartsAddAPauseBetweenLines() {
  let t = ScriptTiming.lineStarts(durationsMs: [1000, 500, 2000])
  #expect(t.starts == [0, 1350, 2200])
  #expect(t.totalMs == 4200)
  #expect(ScriptTiming.lineStarts(durationsMs: []).totalMs == 0)
}
```

`src/WaypointVoices.ts`, exactly:

```ts
import { requireNativeModule } from "expo";

// On-device voices (M22b). Errors carry error.code: "no_voices" (fewer than two voices for any language),
// "busy" (a render is running), "cancelled", "write_failed".
export type ScriptLineIn = { voice: "A" | "B"; text: string };
export type Rendered = { durationMs: number; lineStartsMs: number[]; voices: string };

type NativeVoices = {
  renderScript(lines: ScriptLineIn[], outPath: string, language: string): Promise<Rendered>;
  cancelRender(): void;
};

const native = requireNativeModule<NativeVoices>("WaypointVoices");

// outPath is relative to the app's Documents folder, for example "overviews/<job id>.m4a". language: BCP 47.
export const renderScript = (lines: ScriptLineIn[], outPath: string, language: string): Promise<Rendered> => native.renderScript(lines, outPath, language);
export const cancelRender = (): void => native.cancelRender();
```

`ios/ScriptRenderer.swift` (thin; checked on the device): a `final class ScriptRenderer` holding one `AVSpeechSynthesizer`. `render(lines:outURL:language:)`: picks the voices with `VoicePick.hosts(from: AVSpeechSynthesisVoice.speechVoices().map { VoiceInfo(identifier: $0.identifier, language: $0.language, quality: $0.quality.rawValue, gender: …) }, language:)`; for each line makes an `AVSpeechUtterance` with that voice and `rate = AVSpeechUtteranceDefaultSpeechRate`, calls `write(_:toBufferCallback:)`, converts each `AVAudioPCMBuffer` (stop at the zero-length buffer that ends an utterance) to the common format, appends it to an `AVAudioFile` opened with AAC settings, records the line's duration, and appends 350 ms of silence between lines; `ScriptTiming.lineStarts(durationsMs:)` gives the starts and total. Writes to a temporary file and moves it to `outURL` only when complete (creating `overviews/`). `cancel()` sets a flag checked between buffers; the temporary file is deleted. One render at a time (`busy` otherwise). `voices` in the result is `"system:<identifier A>+<identifier B>"`. Renders while the app is in the foreground; the module does not change the audio session (it only writes files).

`ios/WaypointVoicesModule.swift`: `Name("WaypointVoices")`, `AsyncFunction("renderScript")` taking `[[String: String]]`, the path and the language, resolving the path under `FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]` (refuse `..` and absolute paths with `write_failed`), and `Function("cancelRender")`. Errors become `Exception`s with the codes above, as `WaypointKeysModule` does. The podspec copies `WaypointKeys.podspec` with the name changed (no extra dependency).

Checks without Xcode: `npm run test:swift -w @waypoint/mobile`, root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.

Device check (run once Xcode is installed; a dev screen under `src/app/dev/voices.tsx`, development builds only, like M5's):
1. Render 4 lines alternating A and B: the file plays with two different voices and short pauses; `lineStartsMs` match what you hear.
2. Render 200 lines (an overview's maximum): it finishes, memory stays flat, and the file's duration is what the module reported.
3. Cancel half way: no file is left in `overviews/`.
4. With only the default voices installed, then after downloading an Enhanced voice in Settings › Accessibility › Spoken Content: the enhanced voice is picked. Record the `voices` string the render returns (`system:<A>+<B>`; the dev screen `/dev/voices` from H8 prints it) both times. The iPhone's voice list differs from the Mac's, so check that neither voice is a novelty voice and that A and B differ.

Not in this PR: Kokoro (M22c, written from M22a's report if it says go: the voice pack downloaded from `voice_pack.url`, checked by SHA-256 with CryptoKit, unpacked from an Apple Archive (`.aar`, no third-party unzip), compiled with `MLModel.compileModel(at:)`, kept in Application Support excluded from backup, and used by `ScriptRenderer` when ready); the cloud fallback voice (open question 36).

---

### M25a · Practice sets, and the `made` table

Branch `pr/m25a-practice`. After M34. No new dependencies. Files, all under `apps/mobile/`:
- `src/core/db/schema.ts` (migration 5), `test/migrate.test.ts` (4 → 5), `src/core/made/made.ts`, `src/core/made/practice.ts`, `test/made.test.ts` (new);
- `src/platform/made.ts` (new), `src/platform/jobKinds.ts` (one import line);
- `src/features/made/NewMadeScreen.tsx`, `src/features/made/PracticeScreen.tsx` (new), `src/app/made/new.tsx`, `src/app/practice/[id].tsx` (new), `src/app/_layout.tsx` (two lines), `src/features/capture/SessionScreen.tsx` (one button and a list).

Why it looks like this (G8, G9; PR 25):
- Diagrams, mini apps and practice sets are three job types on the same plumbing. The `made` table stores all three results as their checked JSON, so M25b only adds viewers. This card shows **practice sets**, which need no web view: multiple choice and short answers, drawn with React Native.
- A short answer is "right" when its answer key matches (lowercase words, punctuation dropped, a leading "a/an/the" ignored, decimals kept); otherwise the student sees the expected answer and marks it themselves ("I got it" / "Not quite"). Nothing is sent anywhere while practising.
- Diagram and mini app results are saved when they arrive but only M25b shows them; this card does not offer them.

`src/core/db/schema.ts`: append to `MIGRATIONS`, exactly:

```ts
  {
    version: 5,
    sql: `
CREATE TABLE made (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('diagram', 'mini_app', 'practice')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX made_session ON made (session_id, created_at);
`,
  },
```

`src/core/made/made.ts`, exactly:

```ts
import { DiagramResultSchema, MiniAppResultSchema, PracticeSetResultSchema, type DiagramResult, type MiniAppResult, type PracticeSetResult } from "@waypoint/contracts";
import type { SqlDb } from "../db/sql.ts";

export type MadeKind = "diagram" | "mini_app" | "practice";
export type MadeItem =
  | { id: string; sessionId: string | null; kind: "diagram"; title: string; body: DiagramResult; createdAt: number }
  | { id: string; sessionId: string | null; kind: "mini_app"; title: string; body: MiniAppResult; createdAt: number }
  | { id: string; sessionId: string | null; kind: "practice"; title: string; body: PracticeSetResult; createdAt: number };

type Row = { id: string; session_id: string | null; kind: MadeKind; title: string; body: string; created_at: number };

const SCHEMAS = { diagram: DiagramResultSchema, mini_app: MiniAppResultSchema, practice: PracticeSetResultSchema } as const;

// The opened result of a diagram, mini app or practice job (RESULT_SAVERS). Throws when it is not the contract.
export function saveMade(db: SqlDb, kind: MadeKind, job: { id: string; sessionId: string | null }, text: string, now: number): void {
  const body = SCHEMAS[kind].parse(JSON.parse(text));
  db.run("INSERT OR REPLACE INTO made (id, session_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
    job.id,
    job.sessionId,
    kind,
    body.title,
    JSON.stringify(body),
    now,
  ]);
}

function fromRow(r: Row): MadeItem | null {
  const base = { id: r.id, sessionId: r.session_id, title: r.title, createdAt: r.created_at };
  const value: unknown = JSON.parse(r.body);
  if (r.kind === "diagram") {
    const body = DiagramResultSchema.safeParse(value);
    return body.success ? { ...base, kind: "diagram", body: body.data } : null;
  }
  if (r.kind === "mini_app") {
    const body = MiniAppResultSchema.safeParse(value);
    return body.success ? { ...base, kind: "mini_app", body: body.data } : null;
  }
  const body = PracticeSetResultSchema.safeParse(value);
  return body.success ? { ...base, kind: "practice", body: body.data } : null;
}

export function getMade(db: SqlDb, id: string): MadeItem | null {
  const row = db.get<Row>("SELECT id, session_id, kind, title, body, created_at FROM made WHERE id = ?", [id]);
  return row === null ? null : fromRow(row);
}

export function madeForSession(db: SqlDb, sessionId: string): MadeItem[] {
  return db
    .all<Row>("SELECT id, session_id, kind, title, body, created_at FROM made WHERE session_id = ? ORDER BY created_at DESC", [sessionId])
    .map(fromRow)
    .filter((item): item is MadeItem => item !== null);
}
```

`src/core/made/practice.ts`, exactly:

```ts
import type { PracticeSetResult } from "@waypoint/contracts";

export type PracticeQuestion = PracticeSetResult["questions"][number];

// Lowercase words without punctuation or a leading article, for comparing a typed answer with the model's.
export function answerKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, " ")
    .replace(/(\d)\.(?=\d)/g, "$1DOT")
    .replace(/[.-]/g, " ")
    .replace(/DOT/g, ".")
    .split(/\s+/)
    .filter((w) => w !== "")
    .filter((w, i) => !(i === 0 && (w === "a" || w === "an" || w === "the")))
    .join(" ");
}

// "right": exact choice or the same answer key; "check": a short answer that differs, which the student marks
// themselves after seeing the answer; "wrong": a wrong choice or an empty answer.
export type Grade = "right" | "wrong" | "check";

export function grade(question: PracticeQuestion, given: string | number): Grade {
  if (question.kind === "multiple_choice") return given === question.answer ? "right" : "wrong";
  const typed = typeof given === "string" ? answerKey(given) : "";
  if (typed === "") return "wrong";
  return typed === answerKey(question.answer) ? "right" : "check";
}

export function score(grades: Grade[]): { right: number; total: number } {
  return { right: grades.filter((g) => g === "right").length, total: grades.length };
}
```

`test/made.test.ts`, exactly:

```ts
import { PracticeSetResultSchema } from "@waypoint/contracts";
import { describe, expect, it } from "vitest";
import { startRecordingSession } from "../src/core/capture/recording.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import { getMade, madeForSession, saveMade } from "../src/core/made/made.ts";
import { answerKey, grade, score } from "../src/core/made/practice.ts";
import { createMemoryDb } from "./helpers/db.ts";

const PRACTICE = {
  v: 1,
  title: "Cells",
  questions: [
    { kind: "multiple_choice", prompt: "Powerhouse?", choices: ["Nucleus", "Mitochondria"], answer: 1, explanation: "It makes ATP." },
    { kind: "short_answer", prompt: "Unit of life?", answer: "The cell", explanation: "Everything is made of cells." },
    { kind: "short_answer", prompt: "Pi to 2 places?", answer: "3.14", explanation: "Pi." },
  ],
};

function setup() {
  const db = createMemoryDb();
  migrate(db);
  let n = 0;
  const deps = { now: () => 1000, newId: () => `id_${++n}` };
  return { db, session: startRecordingSession(db, deps, ensureDefaultSpace(db, deps).id, true) };
}

describe("made", () => {
  it("saves a practice set and reads it back by session", () => {
    const { db, session } = setup();
    saveMade(db, "practice", { id: "job_1", sessionId: session.id }, JSON.stringify(PRACTICE), 5);
    const item = getMade(db, "job_1");
    expect(item?.kind).toBe("practice");
    expect(item?.title).toBe("Cells");
    expect(madeForSession(db, session.id)).toHaveLength(1);
  });
  it("a result that is not its contract throws; another kind's contract too", () => {
    const { db } = setup();
    expect(() => saveMade(db, "diagram", { id: "job_2", sessionId: null }, JSON.stringify(PRACTICE), 5)).toThrow();
    expect(getMade(db, "job_2")).toBeNull();
  });
});

describe("practice grading", () => {
  const set = PracticeSetResultSchema.parse(PRACTICE);
  const mc = set.questions[0]!;
  const short = set.questions[1]!;
  const pi = set.questions[2]!;
  it("multiple choice by index; short answers by key", () => {
    expect(grade(mc, 1)).toBe("right");
    expect(grade(mc, 0)).toBe("wrong");
    expect(grade(short, " cell! ")).toBe("right");
    expect(grade(short, "a cell")).toBe("right");
    expect(grade(short, "cells")).toBe("check");
    expect(grade(short, "  ")).toBe("wrong");
    expect(grade(pi, "3.14")).toBe("right");
    expect(score(["right", "check", "wrong"])).toEqual({ right: 1, total: 3 });
  });
  it("answerKey", () => {
    expect(answerKey("The Mitochondria.")).toBe("mitochondria");
    expect(answerKey("well-known")).toBe("well known");
  });
});
```

`src/platform/made.ts`:

```ts
import { JOB_TEXT_MAX_CHARS } from "@waypoint/contracts";
import type { CloudFailure } from "../core/cloud/failure.ts";
import { saveMade, type MadeKind } from "../core/made/made.ts";
import { notesForResearch } from "../core/research/research.ts";
import { getDb } from "./db.ts";
import { RESULT_ROUTES, RESULT_SAVERS } from "./jobResults.ts";
import { startJob } from "./jobs.ts";

// The session's text for a made item, cut at the type's cap.
export function madeText(sessionId: string, kind: MadeKind): string {
  return notesForResearch(getDb(), sessionId, JOB_TEXT_MAX_CHARS[kind]);
}

export function startMade(kind: MadeKind, sessionId: string, key: string, prompt: string | null): Promise<{ ok: true; jobId: string } | { ok: false; failure: CloudFailure }> {
  const text = madeText(sessionId, kind);
  const request = prompt === null || prompt.trim() === "" ? { type: kind, text } : { type: kind, text, prompt: prompt.trim() };
  return startJob({ request, key, sessionId, detail: { kind } });
}

RESULT_SAVERS.practice = (db, job, text) => saveMade(db, "practice", job, text, Date.now());
RESULT_SAVERS.diagram = (db, job, text) => saveMade(db, "diagram", job, text, Date.now());
RESULT_SAVERS.mini_app = (db, job, text) => saveMade(db, "mini_app", job, text, Date.now());
RESULT_ROUTES.practice = (job) => `/practice/${job.id}`;
```

(`notesForResearch` is M19's "session text, cut at a word" helper; it takes the cap as its third argument.) `src/platform/jobKinds.ts`: add `import "./made.ts";`.

Screens (copy written for this card; check it against G8 and G9):
- **`NewMadeScreen`** (`/made/new?sessionId=&kind=practice`): title "Practice set". Body "Questions made from this session to test yourself." An optional field "Anything to focus on?" (max 500). "Show what's sent" shows `madeText(sessionId, "practice")`; when the text is empty: "This session has no text yet." and no button. `QuoteBox` with `useQuote({ task: "practice" })`. Button "Make · `credits` credits" → `startMade("practice", …)` → `/job/<id>`.
- **`PracticeScreen`** (`/practice/[id]`): one question at a time, "Question `n` of `total`". Multiple choice: the choices as `Row`s; after a tap, the right one is marked and the explanation shows; "Next". Short answer: a text field and "Check"; `right` → "Right!" and the explanation; `check` → "The answer: `answer`" with "I got it" / "Not quite"; `wrong` (empty) → asks for an answer. At the end: "`right` of `total` right" and "Try again" (same questions, new order).
- **`SessionScreen`**: a `SecondaryButton` "Practice set" (icon `list.bullet.clipboard`) → `/made/new?sessionId=…&kind=practice`, and a "MADE FROM THIS SESSION" list from `madeForSession` showing practice sets (diagrams and mini apps are listed by M25b).

Checks without Xcode: root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.

Device check (run once Xcode is installed; the API with PR 25): make a practice set from a 10-minute session; answer every question type; the score is right; deleting the session deletes the set.

Not in this PR: diagrams and mini apps on screen (M25b); turning practice answers into flashcards.

---
### M23 · Audio overview: the job, the voices, the player

Branch `pr/m23-audio-overview`. After M34, M22b and M25a (for the migration order). Dependency: `expo-audio` **58.0.11** (published 2026-10-31; SDK 58 asks for `~58.0.11`), for playing the rendered file. Files, all under `apps/mobile/`:
- `package.json` (one dependency), `src/core/db/schema.ts` (migration 6), `test/migrate.test.ts` (5 → 6), `src/core/overviews/overviews.ts`, `test/overviews.test.ts` (new);
- `src/platform/overviews.ts` (new), `src/platform/jobKinds.ts` (one import line), `src/app/(tabs)/_layout.tsx` (one hook);
- `src/features/overviews/NewOverviewScreen.tsx`, `src/features/overviews/OverviewScreen.tsx` (new), `src/app/overview/new.tsx`, `src/app/overview/[id].tsx` (new), `src/app/_layout.tsx` (two lines), `src/features/capture/SessionScreen.tsx` (one button and a list).

Why it looks like this (`docs/architecture.md` flow 2; R1–R3, G7):
- Quote (`overview_script`, 40 credits whatever the length), `POST /v1/jobs` with the session's text (transcript then page text, at most 40,000 characters, about 45 minutes of speech; longer sessions send the start, open question 28) and an optional focus ("Anything to focus on?", at most 500). The sealed two-host script (`OverviewScriptResultSchema`: a title and 4 to 200 lines for hosts A and B) is saved in the `overviews` table, and the job is deleted on the server (M34).
- The voices are rendered on the iPhone with M22b into `overviews/<job id>.m4a` while the app is open; the screen says "Keep Waypoint open while the voices are made". A render cut off by closing the app starts again at the next launch (`useOverviewRenders`). Free: no credits for the voices.
- The player plays the file with `expo-audio`, highlights the line being spoken (`lineAt`), and offers 15 s back and speeds 1×, 1.25×, 1.5×. Playback continues with the screen locked (the `audio` background mode M5 already set). It does not play while a recording is running (M10b's recording screen owns the audio session); the play button says so.
- Video overviews (M24) use the same table with `kind = 'video'`.

`src/core/db/schema.ts`: append to `MIGRATIONS`, exactly:

```ts
  {
    version: 6,
    sql: `
CREATE TABLE overviews (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('audio', 'video')),
  title TEXT NOT NULL,
  script TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'script' CHECK (state IN ('script', 'rendering', 'ready', 'failed')),
  file TEXT,
  duration_ms INTEGER CHECK (duration_ms >= 0),
  line_starts TEXT NOT NULL DEFAULT '[]',
  voices TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX overviews_session ON overviews (session_id, created_at);
`,
  },
```

`src/core/overviews/overviews.ts`, exactly:

```ts
import { OverviewScriptResultSchema, VideoSlidesResultSchema } from "@waypoint/contracts";
import type { SqlDb } from "../db/sql.ts";

export type OverviewKind = "audio" | "video";
export type OverviewState = "script" | "rendering" | "ready" | "failed";
export type Overview = {
  id: string; // the job id
  sessionId: string | null;
  kind: OverviewKind;
  title: string;
  script: string; // the result JSON
  state: OverviewState;
  file: string | null; // relative to Documents
  durationMs: number | null;
  lineStarts: number[];
  voices: string;
  createdAt: number;
};

type Row = { id: string; session_id: string | null; kind: OverviewKind; title: string; script: string; state: OverviewState; file: string | null; duration_ms: number | null; line_starts: string; voices: string; created_at: number };
const COLUMNS = "id, session_id, kind, title, script, state, file, duration_ms, line_starts, voices, created_at";

function fromRow(r: Row): Overview {
  const starts: unknown = JSON.parse(r.line_starts);
  return {
    id: r.id,
    sessionId: r.session_id,
    kind: r.kind,
    title: r.title,
    script: r.script,
    state: r.state,
    file: r.file,
    durationMs: r.duration_ms,
    lineStarts: Array.isArray(starts) ? starts.filter((n): n is number => typeof n === "number") : [],
    voices: r.voices,
    createdAt: r.created_at,
  };
}

// The opened result of an overview_script (audio) or video_slides (video) job. Throws when it is not the contract.
export function saveOverview(db: SqlDb, kind: OverviewKind, job: { id: string; sessionId: string | null }, text: string, now: number): void {
  const value: unknown = JSON.parse(text);
  const parsed = kind === "audio" ? OverviewScriptResultSchema.parse(value) : VideoSlidesResultSchema.parse(value);
  db.run(`INSERT OR REPLACE INTO overviews (id, session_id, kind, title, script, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [
    job.id,
    job.sessionId,
    kind,
    parsed.title,
    JSON.stringify(parsed),
    now,
  ]);
}

export function getOverview(db: SqlDb, id: string): Overview | null {
  const row = db.get<Row>(`SELECT ${COLUMNS} FROM overviews WHERE id = ?`, [id]);
  return row === null ? null : fromRow(row);
}

export function overviewsForSession(db: SqlDb, sessionId: string): Overview[] {
  return db.all<Row>(`SELECT ${COLUMNS} FROM overviews WHERE session_id = ? ORDER BY created_at DESC`, [sessionId]).map(fromRow);
}

// Overviews whose voices still have to be rendered (a render cut off by the app closing starts again).
export function overviewsToRender(db: SqlDb): Overview[] {
  return db.all<Row>(`SELECT ${COLUMNS} FROM overviews WHERE state IN ('script', 'rendering') ORDER BY created_at`).map(fromRow);
}

export function setRendering(db: SqlDb, id: string): void {
  db.run("UPDATE overviews SET state = 'rendering' WHERE id = ?", [id]);
}

export function setRendered(db: SqlDb, id: string, r: { file: string; durationMs: number; lineStarts: number[]; voices: string }): void {
  db.run("UPDATE overviews SET state = 'ready', file = ?, duration_ms = ?, line_starts = ?, voices = ? WHERE id = ?", [r.file, r.durationMs, JSON.stringify(r.lineStarts), r.voices, id]);
}

export function setRenderFailed(db: SqlDb, id: string): void {
  db.run("UPDATE overviews SET state = 'failed' WHERE id = ?", [id]);
}

export type ScriptLine = { voice: "A" | "B"; text: string };

// What the voices say: an audio overview's lines as written; a video's narration, one line per slide, all host A.
export function scriptLines(overview: Overview): ScriptLine[] {
  const value: unknown = JSON.parse(overview.script);
  if (overview.kind === "audio") return OverviewScriptResultSchema.parse(value).lines.map((l) => ({ voice: l.host, text: l.text }));
  return VideoSlidesResultSchema.parse(value).slides.map((s) => ({ voice: "A", text: s.narration }));
}

// The line playing at a moment, for highlighting it in the player.
export function lineAt(lineStarts: number[], ms: number): number {
  let index = -1;
  for (let i = 0; i < lineStarts.length; i++) if ((lineStarts[i] ?? 0) <= ms) index = i;
  return Math.max(0, index);
}
```

`test/overviews.test.ts`, exactly:

```ts
import { describe, expect, it } from "vitest";
import { migrate } from "../src/core/db/migrate.ts";
import { getOverview, lineAt, overviewsToRender, saveOverview, scriptLines, setRendered, setRendering } from "../src/core/overviews/overviews.ts";
import { createMemoryDb } from "./helpers/db.ts";

const AUDIO = { v: 1, title: "Cells", lines: [{ host: "A", text: "Hi" }, { host: "B", text: "Hello" }, { host: "A", text: "Cells" }, { host: "B", text: "Yes" }] };
const VIDEO = { v: 1, title: "Cells", slides: [1, 2, 3].map((n) => ({ heading: `S${n}`, bullets: [], narration: `Slide ${n}` })) };

describe("overviews", () => {
  it("an audio script goes from script to ready", () => {
    const db = createMemoryDb();
    migrate(db);
    saveOverview(db, "audio", { id: "job_1", sessionId: null }, JSON.stringify(AUDIO), 5);
    const saved = getOverview(db, "job_1");
    expect(saved?.state).toBe("script");
    expect(scriptLines(saved!).map((l) => l.voice)).toEqual(["A", "B", "A", "B"]);
    expect(overviewsToRender(db)).toHaveLength(1);
    setRendering(db, "job_1");
    setRendered(db, "job_1", { file: "overviews/job_1.m4a", durationMs: 9000, lineStarts: [0, 2000, 4000, 6000], voices: "system:a+b" });
    expect(getOverview(db, "job_1")).toMatchObject({ state: "ready", durationMs: 9000, lineStarts: [0, 2000, 4000, 6000] });
    expect(overviewsToRender(db)).toHaveLength(0);
  });
  it("a video's lines are its narration, all host A; a wrong contract throws", () => {
    const db = createMemoryDb();
    migrate(db);
    saveOverview(db, "video", { id: "job_2", sessionId: null }, JSON.stringify(VIDEO), 5);
    expect(scriptLines(getOverview(db, "job_2")!)).toEqual([{ voice: "A", text: "Slide 1" }, { voice: "A", text: "Slide 2" }, { voice: "A", text: "Slide 3" }]);
    expect(() => saveOverview(db, "video", { id: "job_3", sessionId: null }, JSON.stringify(AUDIO), 5)).toThrow();
  });
  it("lineAt", () => {
    expect(lineAt([0, 2000, 4000], 0)).toBe(0);
    expect(lineAt([0, 2000, 4000], 3999)).toBe(1);
    expect(lineAt([0, 2000, 4000], 99999)).toBe(2);
    expect(lineAt([], 5)).toBe(0);
  });
});
```

`src/platform/overviews.ts`, exactly:

```ts
import { useEffect } from "react";
import { AppState } from "react-native";
import { JOB_TEXT_MAX_CHARS } from "@waypoint/contracts";
import { renderScript } from "../../modules/waypoint-voices/index.ts";
import type { CloudFailure } from "../core/cloud/failure.ts";
import { getOverview, overviewsToRender, saveOverview, scriptLines, setRendered, setRenderFailed, setRendering } from "../core/overviews/overviews.ts";
import { notesForResearch } from "../core/research/research.ts";
import { getDb, writeDb } from "./db.ts";
import { RESULT_ROUTES, RESULT_SAVERS } from "./jobResults.ts";
import { startJob } from "./jobs.ts";

export function overviewText(sessionId: string): string {
  return notesForResearch(getDb(), sessionId, JOB_TEXT_MAX_CHARS.overview_script);
}

export function startOverview(sessionId: string, key: string, prompt: string | null): Promise<{ ok: true; jobId: string } | { ok: false; failure: CloudFailure }> {
  const text = overviewText(sessionId);
  const focus = prompt?.trim() ?? "";
  const request = focus === "" ? { type: "overview_script" as const, text } : { type: "overview_script" as const, text, prompt: focus };
  return startJob({ request, key, sessionId, detail: {} });
}

const rendering = new Set<string>();

// Speaks the saved script into overviews/<id>.m4a. One render at a time per overview; a failure can be retried.
export async function renderOverview(id: string): Promise<void> {
  const overview = getOverview(getDb(), id);
  if (overview === null || overview.kind !== "audio" || overview.state === "ready" || rendering.has(id)) return;
  rendering.add(id);
  writeDb((db) => setRendering(db, id));
  try {
    const file = `overviews/${id}.m4a`;
    const language = Intl.DateTimeFormat().resolvedOptions().locale;
    const done = await renderScript(scriptLines(overview), file, language);
    writeDb((db) => setRendered(db, id, { file, durationMs: done.durationMs, lineStarts: done.lineStartsMs, voices: done.voices }));
  } catch {
    writeDb((db) => setRenderFailed(db, id));
  } finally {
    rendering.delete(id);
  }
}

// Renders audio overviews whose voices are not made yet, at launch and when the app comes back.
export function useOverviewRenders(): void {
  useEffect(() => {
    const run = (): void => {
      for (const o of overviewsToRender(getDb())) if (o.kind === "audio") void renderOverview(o.id);
    };
    run();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    return () => sub.remove();
  }, []);
}

RESULT_SAVERS.overview_script = (db, job, text) => saveOverview(db, "audio", job, text, Date.now());
RESULT_ROUTES.overview_script = (job) => `/overview/${job.id}`;
```

`src/platform/jobKinds.ts`: add `import "./overviews.ts";`. `src/app/(tabs)/_layout.tsx`: add `useOverviewRenders();`.

Screens (copy written for this card; check it against G7 and R1–R3):
- **`NewOverviewScreen`** (`/overview/new?sessionId=`): title "Audio overview". Body "Two hosts talk through this session. The script is written in the cloud; the voices are made on this iPhone." Optional field "Anything to focus on?". "Show what's sent" shows `overviewText(sessionId)`; empty text → "This session has no text yet." `QuoteBox` with `useQuote({ task: "overview_script" })`. Button "Make · `credits` credits" → `startOverview` → `/job/<id>`.
- **`OverviewScreen`** (`/overview/[id]`): title the overview's title. State `script`/`rendering`: "Making the voices… Keep Waypoint open." with a spinner (the render runs in `useOverviewRenders`, or starts here with `renderOverview(id)` on focus). `failed`: "Couldn't make the voices." and "Try again" (`renderOverview`). `ready`: an `expo-audio` player (`useAudioPlayer(fileUri(file))`, `useAudioPlayerStatus`), play/pause, a 15 s back button, a speed button cycling 1×/1.25×/1.5× (`player.setPlaybackRate`), the elapsed and total time (`formatClock`), and the script lines below with the current one (`lineAt(lineStarts, currentTime × 1000)`) highlighted; tapping a line seeks to it. Caption "Voices made on this iPhone." Before the first play, `setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true })`.
- **`SessionScreen`**: a `SecondaryButton` "Audio overview" (icon `waveform`) → `/overview/new?sessionId=…`; overviews of the session listed with their state, opening `/overview/<id>`.

Checks without Xcode: root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.

Device check (run once Xcode is installed; the API with PR 22B): make an overview of a 10-minute session; the job finishes, the voices render, the file plays with two voices and highlights the lines; lock the screen: playback continues; kill the app while rendering and reopen: the render starts again and finishes; deleting the session deletes the overview row (delete its file too: `deleteSessionFiles` does not cover `overviews/`, so `SessionScreen`'s delete also calls `deleteFile` for each overview's file).

Not in this PR: Kokoro voices (M22c); sharing an overview (stage 4); the cloud fallback voice.

---

### M24a · Video overview, part A: slide timing and the native renderer (`waypoint-video`)

Branch `pr/m24a-video-render`. After M23. No new npm dependencies. Files, all under `apps/mobile/`:
- `modules/waypoint-video/expo-module.config.json`, `index.ts`, `src/WaypointVideo.ts`, `ios/WaypointVideo.podspec`, `ios/WaypointVideoModule.swift`, `ios/SlideVideoWriter.swift` (new);
- `modules/waypoint-video/ios/Core/SlideTimeline.swift`, `ios/Tests/SlideTimelineTests.swift` (new); `modules/Package.swift` (`VideoCore`, `VideoCoreTests`).

Why it looks like this (`docs/architecture.md` section 2: "narration and assembly on the iPhone; no cloud renderer"):
- A video overview is the job's slides (`VideoSlidesResultSchema`: 3 to 15 slides, each a heading, up to 5 bullets and a narration) drawn on the phone, with the narration rendered by M22b as one audio file, one line per slide. Each slide shows from the start of its narration to the start of the next (`SlideTimeline`).
- A slide is a still picture, so the writer appends **one frame per slide** at the slide's start time (and the last frame again at the end), which keeps rendering fast and the file small: H.264 at 1280×720, about 1.5 Mbit/s, with the narration's AAC track copied in (no re-encode).
- Slides are drawn with UIKit text (`UIGraphicsImageRenderer`): a heading at 56 pt semibold, bullets at 34 pt with "•", wrapped and shrunk to fit, in the app's light theme colours, the title slide first. No image or remote resource is used.

`ios/Core/SlideTimeline.swift`, exactly:

```swift
import Foundation

// When each slide shows in the video: from the start of its narration to the start of the next slide's; the first
// from 0, the last to the end of the audio. Times in milliseconds. Starts are made non-decreasing first, so a slide
// whose narration does not start after the one before it gets no time.
public struct SlideSpan: Equatable, Sendable {
  public let index: Int
  public let startMs: Int
  public let endMs: Int
}

public enum SlideTimeline {
  public static func spans(slideStartsMs: [Int], totalMs: Int) -> [SlideSpan] {
    guard !slideStartsMs.isEmpty, totalMs > 0 else { return [] }
    var starts: [Int] = []
    for (i, start) in slideStartsMs.enumerated() {
      starts.append(i == 0 ? 0 : min(max(starts[i - 1], start), totalMs))
    }
    return starts.enumerated().compactMap { i, start in
      let end = i + 1 < starts.count ? starts[i + 1] : totalMs
      return end > start ? SlideSpan(index: i, startMs: start, endMs: end) : nil
    }
  }

  // The slide on screen at a moment (for the player's slide list), or nil past the end.
  public static func slide(at ms: Int, in spans: [SlideSpan]) -> Int? {
    spans.first { ms >= $0.startMs && ms < $0.endMs }?.index
  }
}
```

`ios/Tests/SlideTimelineTests.swift`, exactly:

```swift
import Testing
@testable import VideoCore

@Test func spansCoverTheAudioFromZero() {
  let spans = SlideTimeline.spans(slideStartsMs: [200, 5000, 9000], totalMs: 12000)
  #expect(spans == [SlideSpan(index: 0, startMs: 0, endMs: 5000), SlideSpan(index: 1, startMs: 5000, endMs: 9000), SlideSpan(index: 2, startMs: 9000, endMs: 12000)])
  #expect(SlideTimeline.slide(at: 4999, in: spans) == 0)
  #expect(SlideTimeline.slide(at: 12000, in: spans) == nil)
}

@Test func outOfOrderOrLateStartsNeverGoBackwards() {
  let spans = SlideTimeline.spans(slideStartsMs: [0, 8000, 6000, 20000], totalMs: 10000)
  #expect(spans.map(\.index) == [0, 2])
  #expect(spans.last?.endMs == 10000)
  #expect(SlideTimeline.spans(slideStartsMs: [], totalMs: 10).isEmpty)
}
```

`src/WaypointVideo.ts`, exactly:

```ts
import { requireNativeModule } from "expo";

// Errors carry error.code: "bad_input", "no_audio", "write_failed", "busy".
export type SlideIn = { heading: string; bullets: string[] };

type NativeVideo = {
  renderSlides(title: string, slides: SlideIn[], slideStartsMs: number[], audioPath: string, outPath: string): Promise<{ durationMs: number }>;
};

const native = requireNativeModule<NativeVideo>("WaypointVideo");

// Paths are relative to Documents. slideStartsMs: when each slide's narration starts in the audio file (M22b's
// lineStartsMs). The title is drawn on the first slide above its heading.
export const renderSlides = (title: string, slides: SlideIn[], slideStartsMs: number[], audioPath: string, outPath: string): Promise<{ durationMs: number }> =>
  native.renderSlides(title, slides, slideStartsMs, audioPath, outPath);
```

`ios/SlideVideoWriter.swift` (thin; checked on the device): reads the audio duration from `AVURLAsset(url:).load(.duration)`; `SlideTimeline.spans(slideStartsMs:totalMs:)`; an `AVAssetWriter` (`.mp4`) with a video input (`AVVideoCodecType.h264`, 1280×720, `AVVideoAverageBitRateKey: 1_500_000`) and an `AVAssetWriterInputPixelBufferAdaptor`; for each span, draw the slide into a `CVPixelBuffer` from the adaptor's pool and append it at `CMTime(value: span.startMs, timescale: 1000)`, and append the last slide again at `totalMs - 1`; an audio input with `outputSettings: nil` and the source's format description, fed by an `AVAssetReader` track output with `outputSettings: nil` (sample buffers copied as they are). Writes to a temporary file, moves it to `outPath` when `finishWriting` succeeds, deletes it otherwise. One render at a time.

`ios/WaypointVideoModule.swift`: `Name("WaypointVideo")`, `AsyncFunction("renderSlides")` taking the title, `[[String: Any]]` slides (heading string, bullets string array), `[Double]` starts and the two paths (resolved under Documents, refusing `..` and absolute paths). The podspec as `WaypointVoices.podspec`.

Checks without Xcode: `npm run test:swift -w @waypoint/mobile`, root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.

Device check (run once Xcode is installed; a dev screen `src/app/dev/video.tsx` that renders three slides over an M22b narration): the `.mp4` plays in the Files app with each slide changing when its narration starts; 15 slides of 30 s each render in under 30 seconds on the oldest test iPhone; text never runs off a slide.

Not in this PR: the job and the player (M24b).

---

### M24b · Video overview, part B: the job, assembly, the player

Branch `pr/m24b-video`. After M24a. Dependency: `expo-video` **58.0.13** (published 2026-10-28; SDK 58 asks for `~58.0.13`). Files, all under `apps/mobile/`: `package.json`; `src/platform/videos.ts` (new), `src/platform/jobKinds.ts` (one import line); `src/features/overviews/NewVideoScreen.tsx`, `src/features/overviews/VideoScreen.tsx` (new), `src/app/video/new.tsx`, `src/app/video/[id].tsx` (new), `src/app/_layout.tsx` (two lines), `src/features/capture/SessionScreen.tsx` (one button), `src/platform/overviews.ts` (`useOverviewRenders` also renders `video` rows by calling `renderVideo`).

Why it looks like this (G10): `video_slides` (50 credits; text at most 48,000 characters, open question 28) through M34; the saver stores the result as an `overviews` row with `kind = 'video'`; rendering is two steps on the phone, both free: the narration with M22b (`scriptLines` gives one host-A line per slide) into `overviews/<id>-narration.m4a`, then the slides with M24a into `overviews/<id>.mp4` using the narration's `lineStartsMs` as the slide starts. The narration file is deleted after the video is written. `setRendered` stores the `.mp4`, its duration and the slide starts.

`src/platform/videos.ts`:

```ts
import { VideoSlidesResultSchema } from "@waypoint/contracts";
import { renderSlides } from "../../modules/waypoint-video/index.ts";
import { renderScript } from "../../modules/waypoint-voices/index.ts";
import type { CloudFailure } from "../core/cloud/failure.ts";
import { getOverview, saveOverview, scriptLines, setRendered, setRenderFailed, setRendering } from "../core/overviews/overviews.ts";
import { getDb, writeDb } from "./db.ts";
import { deleteFile } from "./files.ts";
import { RESULT_ROUTES, RESULT_SAVERS } from "./jobResults.ts";
import { startJob } from "./jobs.ts";
import { overviewText } from "./overviews.ts";

export function startVideo(sessionId: string, key: string, prompt: string | null): Promise<{ ok: true; jobId: string } | { ok: false; failure: CloudFailure }> {
  const text = overviewText(sessionId).slice(0, 48_000);
  const focus = prompt?.trim() ?? "";
  const request = focus === "" ? { type: "video_slides" as const, text } : { type: "video_slides" as const, text, prompt: focus };
  return startJob({ request, key, sessionId, detail: {} });
}

const rendering = new Set<string>();

export async function renderVideo(id: string): Promise<void> {
  const video = getOverview(getDb(), id);
  if (video === null || video.kind !== "video" || video.state === "ready" || rendering.has(id)) return;
  rendering.add(id);
  writeDb((db) => setRendering(db, id));
  const narration = `overviews/${id}-narration.m4a`;
  try {
    const voice = await renderScript(scriptLines(video), narration, Intl.DateTimeFormat().resolvedOptions().locale);
    const slides = VideoSlidesResultSchema.parse(JSON.parse(video.script)).slides.map((s) => ({ heading: s.heading, bullets: s.bullets }));
    const file = `overviews/${id}.mp4`;
    const done = await renderSlides(video.title, slides, voice.lineStartsMs, narration, file);
    writeDb((db) => setRendered(db, id, { file, durationMs: done.durationMs, lineStarts: voice.lineStartsMs, voices: voice.voices }));
  } catch {
    writeDb((db) => setRenderFailed(db, id));
  } finally {
    deleteFile(narration);
    rendering.delete(id);
  }
}

RESULT_SAVERS.video_slides = (db, job, text) => saveOverview(db, "video", job, text, Date.now());
RESULT_ROUTES.video_slides = (job) => `/video/${job.id}`;
```

(`overviewText` cuts at 40,000 characters, under the 48,000 cap; the `slice` is only a guard.)

Screens: **`NewVideoScreen`** as M23's with title "Video overview", body "Slides and a narrator, made from this session. The slides are written in the cloud; the video is made on this iPhone.", `useQuote({ task: "video_slides" })`. **`VideoScreen`** (`/video/[id]`): while rendering, "Making the video… Keep Waypoint open."; `ready`: `VideoView` with `useVideoPlayer(fileUri(file))` (native controls, fullscreen allowed), and below it the slide headings, the current one highlighted (`lineAt` over the stored slide starts), tapping seeks. **`SessionScreen`**: a `SecondaryButton` "Video overview" (icon `play.rectangle`).

Checks without Xcode: root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.

Device check (run once Xcode is installed; the API with PR 25): make a video of a 10-minute session; it renders and plays with slides changing on time; the narration file is gone afterwards; kill the app while rendering: it starts again at launch.

Not in this PR: exporting the video to Photos or sharing it.

---

### M25b · Native module `waypoint-sandbox`: diagrams and mini apps in a locked web view (hard gate)

Branch `pr/m25b-sandbox`. After M25a. No new npm dependencies (no `react-native-webview`: it cannot block every load and always offers a bridge when messaging is on). Files, all under `apps/mobile/`:
- `modules/waypoint-sandbox/expo-module.config.json`, `index.ts`, `src/WaypointSandbox.tsx`, `ios/WaypointSandbox.podspec`, `ios/WaypointSandboxModule.swift`, `ios/SandboxWebView.swift`, `ios/Resources/mermaid.min.js` (new; 5,537,838 bytes);
- `modules/waypoint-sandbox/gate/gate.html` (new), `src/app/dev/sandbox.tsx` (new, development builds only, inside the existing `__DEV__` group in `_layout.tsx`);
- `src/core/made/sandbox.ts`, `src/core/made/gate.ts`, `test/sandbox.test.ts` (new);
- `src/features/made/DiagramScreen.tsx`, `src/features/made/MiniAppScreen.tsx` (new), `src/app/diagram/[id].tsx`, `src/app/mini-app/[id].tsx` (new), `src/app/_layout.tsx` (two lines plus the dev line), `src/platform/made.ts` (two route lines), `src/features/made/NewMadeScreen.tsx` (the diagram choice; the mini app choice behind the flag), `src/features/capture/SessionScreen.tsx` (two buttons, list rows).

Why it looks like this (hardening note for M25: **a hard gate**; `MiniAppDraftSchema`'s comment in PR 25):
- A mini app is HTML a model wrote from the student's notes and from whatever the notes quoted. If it could load anything, it could send the notes to someone else's server. So it runs only in a web view that **cannot reach the network, keeps nothing, has no bridge to the app and cannot navigate**. Every one of these is enforced natively, in layers, and checked on a real iPhone with the gate page before any build shows a mini app:
  1. `WKContentRuleList` blocking every URL load except `about:blank` and `data:` (three rules, because WebKit's `url-filter` has no alternation: block `.*`, then `ignore-previous-rules` for `^about:blank`, then for `^data:`; compiled once, added before the first load; if compiling fails, one content-free log line and nothing is shown);
  2. a Content-Security-Policy `<meta>` placed before the generated HTML: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'`;
  3. a `WKUserScript` at document start in every frame that deletes the network and storage APIs (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `RTCPeerConnection`, `webkitRTCPeerConnection`, `navigator.sendBeacon`, `Worker`, `SharedWorker`, `navigator.serviceWorker`, `indexedDB`, `localStorage`, `sessionStorage`, `caches`), because CSP does not cover WebRTC or DNS prefetching. **M25c** (`docs/cards/hardening-2.md`) replaces it with a script that also blocks frames, objects and embeds made at run time, after the re-check of PR #115 found that a frame whose load is cancelled keeps a window this script never runs in;
  4. `websiteDataStore = .nonPersistent()`; no `WKScriptMessageHandler` at all; `javaScriptCanOpenWindowsAutomatically = false` and `createWebViewWith` returning nil; `decidePolicyFor navigationAction` allowing only the first `about:blank` main-frame load (and `about:blank`/`about:srcdoc` subframes, so the user script runs in them) and cancelling everything else, including links, form posts, `location` changes and the app's own URL scheme; `isInspectable = false` outside development builds; media autoplay off.
  5. (M25c) Lockdown Mode for the view, and the mini app's HTML rebuilt from an allow-list before it is loaded (`src/core/made/miniAppHtml.ts`).
- **Diagrams** use the same view: Mermaid 12.3.0's browser bundle (`dist/mermaid.min.js`, MIT, no `eval` or `new Function` in it, checked) is shipped inside the module (5.5 MB in the app) and inlined into the page with `securityLevel: "strict"`, so a diagram draws offline and its labels cannot run script. The diagram source is put into the page as JSON with `<` escaped.
- **The gate.** `gate/gate.html` tries every way out we know of. The owner loads it on a real iPhone through the dev screen with a logging server on the Mac; the gate passes only if the server logs **no request at all**, the page shows every probe blocked, every storage API is gone or throws and the cookie stays empty, and the WebContent process opens no connection (Instruments, Network template); since M25c also no UDP packet reaches the Mac and the page shows `frames: none` and `lockdown: on`. Until then the KV flags `mini_app_viewer` and `diagram_viewer` (owner decision on PR #115) stay `false`. With a flag off the app neither offers nor opens that kind: a saved mini app shows "Mini apps aren't available yet", a saved diagram "Diagrams aren't available yet", and the Diagram and Mini app buttons, list rows and choices are hidden.

`ios/Resources/mermaid.min.js`: from the npm tarball, never edited:

```sh
cd "$(mktemp -d)" && npm pack mermaid@12.3.0 --silent && tar xzf mermaid-12.3.0.tgz package/dist/mermaid.min.js
shasum -a 256 package/dist/mermaid.min.js   # 336df803d87a38b70a01e736e666c8f7601d2ce42f5e47c8fafe5d721074b9a3
cp package/dist/mermaid.min.js <repo>/apps/mobile/modules/waypoint-sandbox/ios/Resources/mermaid.min.js
```

Podspec: as `WaypointKeys.podspec` plus `s.resource_bundles = { 'WaypointSandbox' => ['Resources/mermaid.min.js'] }`; Swift reads it from `Bundle(for: SandboxWebView.self).url(forResource: "WaypointSandbox", withExtension: "bundle")`.

`src/core/made/sandbox.ts`, exactly:

```ts
// The page a sandboxed web view loads (M25b). Everything here is defence in depth; the native view is the control.
export const SANDBOX_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; " +
  "connect-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'";

const HEAD = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"><meta name="viewport" content="width=device-width, initial-scale=1">`;

// A model's HTML, after our head: the CSP meta comes first, so it applies before anything the HTML contains.
export function miniAppPage(html: string): string {
  return `${HEAD}</head><body>${html}</body></html>`;
}

// JSON that is safe inside <script>: "<" never appears, so "</script>" cannot end the script.
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

// A Mermaid diagram page. The native view inserts Mermaid's own script where MERMAID_SCRIPT is.
export const MERMAID_SCRIPT = "/*MERMAID*/";
export function diagramPage(source: string, dark: boolean): string {
  return (
    `${HEAD}<style>body{margin:0;padding:16px;background:${dark ? "#000" : "#fff"}}svg{max-width:100%;height:auto}</style></head><body><div id="d"></div>` +
    `<script>${MERMAID_SCRIPT}</script><script>` +
    `mermaid.initialize({startOnLoad:false,securityLevel:"strict",theme:${dark ? '"dark"' : '"default"'}});` +
    `mermaid.render("g",${scriptJson(source)}).then(function(r){document.getElementById("d").innerHTML=r.svg;},function(){document.getElementById("d").textContent="This diagram couldn't be drawn.";});` +
    `</script></body></html>`
  );
}
```

`test/sandbox.test.ts`, exactly:

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MERMAID_SCRIPT, SANDBOX_CSP, diagramPage, miniAppPage, scriptJson } from "../src/core/made/sandbox.ts";

describe("sandbox pages", () => {
  it("the CSP comes before the model's HTML", () => {
    const page = miniAppPage("<script>fetch('x')</script>");
    expect(page.startsWith("<!doctype html>")).toBe(true);
    expect(page.indexOf(SANDBOX_CSP)).toBeLessThan(page.indexOf("<script>fetch"));
  });
  it("scriptJson never contains <", () => {
    const s = scriptJson("</script><script>alert(1) ");
    expect(s.includes("<")).toBe(false);
    expect(JSON.parse(s)).toBe("</script><script>alert(1) ");
  });
  it("diagram page", () => {
    const page = diagramPage("graph TD; A-->B </script>", false);
    expect(page).toContain('securityLevel:"strict"');
    expect(page.split(MERMAID_SCRIPT)).toHaveLength(2);
    expect(page.match(/<\/script>/g)).toHaveLength(2);
  });
});

describe("the bundled Mermaid", () => {
  it("is mermaid@12.3.0's dist/mermaid.min.js, unchanged", () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), "../modules/waypoint-sandbox/ios/Resources/mermaid.min.js");
    expect(createHash("sha256").update(readFileSync(file)).digest("hex")).toBe("336df803d87a38b70a01e736e666c8f7601d2ce42f5e47c8fafe5d721074b9a3");
  });
});
```

`src/WaypointSandbox.tsx`: `requireNativeView("WaypointSandbox")` wrapped as `<SandboxView page={string} mermaid={boolean} style={…} />`. No events back from the page (there is no bridge); the view reports only load failures to native logs.

`ios/SandboxWebView.swift` (an `ExpoView`; checked on the device): builds the `WKWebViewConfiguration` with the four layers above; compiles the rule list `[{"trigger":{"url-filter":".*"},"action":{"type":"block"}},{"trigger":{"url-filter":"^about:blank"},"action":{"type":"ignore-previous-rules"}},{"trigger":{"url-filter":"^data:"},"action":{"type":"ignore-previous-rules"}}]` (WebKit rejects `^(about:blank|data:)`: "Disjunctions are not supported yet") with `WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "waypoint-sandbox", encodedContentRuleList:)` and adds it **before** `loadHTMLString(page, baseURL: nil)`; when `mermaid` is true it replaces the **first** `/*MERMAID*/` in the page with the bundled script (only the first, so a label containing the marker stays inert; if the marker or the script is missing, it shows nothing). The user script that deletes APIs is, exactly: `["fetch","XMLHttpRequest","WebSocket","EventSource","RTCPeerConnection","webkitRTCPeerConnection","Worker","SharedWorker","caches","indexedDB","localStorage","sessionStorage"].forEach(function(k){try{Object.defineProperty(window,k,{value:undefined,configurable:false,writable:false})}catch(e){}});try{Object.defineProperty(navigator,"sendBeacon",{value:undefined});Object.defineProperty(navigator,"serviceWorker",{value:undefined})}catch(e){}`, injected at `.atDocumentStart` with `forMainFrameOnly: false`.

`gate/gate.html` as first written (`HOST` is replaced by the dev screen with the Mac's address). The merged file differs: PR #115 added a `script: ran` marker, the storage lines (`typeof`-style, no value after a reload) and frame-realm probes, and M25c replaces the realm probes with run-time frame probes, a frame count and a Lockdown line. The file in the repository is the reference:

```html
<!doctype html>
<html>
<head><meta charset="utf-8"><title>Sandbox gate</title>
<link rel="dns-prefetch" href="//HOST">
<link rel="preconnect" href="http://HOST:8999">
<link rel="prefetch" href="http://HOST:8999/link-prefetch">
<link rel="stylesheet" href="http://HOST:8999/link-css">
<style>
  @import url("http://HOST:8999/css-import");
  @font-face { font-family: x; src: url("http://HOST:8999/font"); }
  body { font: 14px -apple-system; background: url("http://HOST:8999/css-bg"); }
  .f { font-family: x; }
</style>
<meta http-equiv="refresh" content="3; url=http://HOST:8999/meta-refresh">
</head>
<body>
<h3>Sandbox gate</h3><div class="f">font probe</div><ol id="out"></ol>
<img src="http://HOST:8999/img">
<img srcset="http://HOST:8999/srcset 2x">
<iframe src="http://HOST:8999/iframe"></iframe>
<object data="http://HOST:8999/object"></object>
<video src="http://HOST:8999/video" autoplay muted></video>
<audio src="http://HOST:8999/audio" autoplay></audio>
<a id="ping" href="#" ping="http://HOST:8999/a-ping">ping</a>
<form id="form" action="http://HOST:8999/form" method="post"><input name="x" value="1"></form>
<script>
const H = "http://HOST:8999/";
const out = document.getElementById("out");
const say = (name, result) => { const li = document.createElement("li"); li.textContent = name + ": " + result; out.appendChild(li); };
const probe = async (name, run) => { try { await run(); say(name, "no error (check the server log)"); } catch (e) { say(name, "blocked (" + (e && e.name) + ")"); } };
probe("fetch", () => fetch(H + "fetch"));
probe("xhr", () => new Promise((ok, no) => { const x = new XMLHttpRequest(); x.open("GET", H + "xhr"); x.onload = ok; x.onerror = () => no(new Error("xhr")); x.send(); }));
probe("websocket", () => new Promise((ok, no) => { const w = new WebSocket("ws://HOST:8999/ws"); w.onopen = ok; w.onerror = () => no(new Error("ws")); }));
probe("eventsource", () => new Promise((ok, no) => { const s = new EventSource(H + "sse"); s.onopen = ok; s.onerror = () => no(new Error("sse")); }));
probe("beacon", () => { if (!navigator.sendBeacon(H + "beacon", "x")) throw new Error("beacon"); });
probe("webrtc", async () => { const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:HOST:8999" }] }); pc.createDataChannel("x"); await pc.setLocalDescription(await pc.createOffer()); });
probe("worker", () => new Worker("data:text/javascript,fetch('" + H + "worker')"));
probe("import", () => import(H + "import.js"));
probe("image", () => new Promise((ok, no) => { const i = new Image(); i.onload = ok; i.onerror = () => no(new Error("img")); i.src = H + "js-image"; }));
probe("window.open", () => { if (window.open(H + "open") === null) throw new Error("open"); });
probe("localStorage", () => { localStorage.setItem("gate", String(Date.now())); say("localStorage before", String(localStorage.getItem("gate"))); });
probe("indexedDB", () => new Promise((ok, no) => { const r = indexedDB.open("gate"); r.onsuccess = ok; r.onerror = () => no(new Error("idb")); }));
probe("cookie", () => { document.cookie = "gate=1"; say("cookie", document.cookie || "(empty)"); });
probe("bridge", () => { if (window.webkit && window.webkit.messageHandlers && Object.keys(window.webkit.messageHandlers).length) throw new Error("bridge present"); say("bridge", "none"); });
setTimeout(() => { document.getElementById("ping").click(); document.getElementById("form").submit(); }, 500);
setTimeout(() => { location.href = H + "location"; }, 1000);
setTimeout(() => { location.href = "waypoint://gate"; }, 1500);
</script>
</body>
</html>
```

`src/core/made/gate.ts` exports `GATE_HTML`, the file above as one template string (Metro cannot import `.html`); `test/sandbox.test.ts` adds a test that it equals `modules/waypoint-sandbox/gate/gate.html` read with `node:fs`. `src/app/dev/sandbox.tsx`: a text field for the Mac's LAN address, a button that loads `GATE_HTML.replaceAll("HOST", address)` into `SandboxView` with `mermaid={false}`, and a second button that reloads it (a new web view; M25c adds a third that loads the gate through `miniAppPage`).

Screens:
- **`DiagramScreen`** (`/diagram/[id]`): only when `config.flags.diagram_viewer === true`, else "Diagrams aren't available yet."; the title, then `SandboxView` with `diagramPage(body.mermaid, dark)` and `mermaid`, filling the screen with pinch-zoom; caption "Drawn on this iPhone."
- **`MiniAppScreen`** (`/mini-app/[id]`): only when `config.flags.mini_app_viewer === true` (M13's cached config); then `SandboxView` with `miniAppPage(body.html)` and caption "This mini app can't use the internet or see anything else on your iPhone." Otherwise "Mini apps aren't available yet."
- `NewMadeScreen` gains "Diagram" (`task: "diagram"`, 18 credits) only with `diagram_viewer` on, and "Mini app" (40 credits) only with `mini_app_viewer` on; `SessionScreen` gains the two buttons on the same rules and lists diagrams and mini apps; `src/platform/made.ts` gains `RESULT_ROUTES.diagram = (job) => `/diagram/${job.id}`;` and `RESULT_ROUTES.mini_app = (job) => `/mini-app/${job.id}`;`.

Checks without Xcode: `npm run test:swift -w @waypoint/mobile` (unchanged), root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.

**Gate (run once Xcode is installed, on a real iPhone on the same Wi-Fi as the Mac; record the result in the PR):**
1. On the Mac: `python3 -m http.server 8999` in an empty folder (it logs every request), and Instruments' Network template attached to the app.
2. In a development build open `/dev/sandbox`, enter the Mac's address, load the gate. Wait 10 seconds.
3. **Pass** only if: the page shows `script: ran`; the server logged nothing; every probe on the page says "blocked" or shows that the API is gone, and "bridge: none"; `localStorage`, `sessionStorage`, `indexedDB` and `caches` are each undefined or throw, and the cookie stays empty (a stored value is not checked after "Reload": with the user script there is no storage API to store one); the page did not navigate away (still the gate after 10 s); Instruments shows no connection from the WebContent process. **Superseded by M25c's device gate** (`docs/cards/hardening-2.md`), which adds the UDP listener, the "as a mini app" load, `frames: none` and `lockdown: on`.
4. The same with a mini app made by the real job (ask it for "a quiz that loads a picture of a cell from the web"): nothing reaches the network.
5. Only after M25c's gate passes does the owner set `mini_app_viewer` and `diagram_viewer` to `true` in KV. Diagrams: one per kind (flowchart, mindmap, timeline, sequence) draws offline in Airplane Mode.

Not in this PR: printing or sharing diagrams; mini apps that save progress (they cannot keep anything, by design).

---
## 6. Stage 4: groups, keys, sync, sharing

Stage 4's server side is merged: PR 27 (groups, invites, members), S2 (group key envelopes), PR 28 (changes, the socket, sync pushes), PR 29 (blobs), PR 30 (links), H1–H2.

### M3c · API client: groups, keys, sync, blobs, links

Branch `pr/m3c-client-groups`. After M3b. No new dependencies. Files: `packages/api-client/src/client.ts`, `packages/api-client/test/groups-sync.test.ts` (new).

Why it looks like this: every stage 4 route, typed from `packages/contracts`. Signed: creating groups and invites, accepting invites, removing members, posting key envelopes, creating and revoking links (`docs/security.md` section 15). Session only: changes, blobs and every `GET`. `postChange` takes the change's own id as its Idempotency-Key, so a retried POST is stored once. A blob is uploaded as raw locked bytes (`application/octet-stream`; `Content-Length` is set by `fetch`). The socket is opened by the app (React Native's `WebSocket` accepts headers); the client only builds its `wss://` URL and hands out the token.

`src/client.ts`: add to the contracts import `BlobStoredSchema`, `ChangesPageSchema`, `CreateGroupRequestSchema`, `CreateInviteRequestSchema`, `CreateLinkRequestSchema`, `GroupDevicesSchema`, `GroupKeysRequestSchema`, `GroupKeysResponseSchema`, `GroupListSchema`, `GroupViewSchema`, `InviteViewSchema`, `LinkRevokedSchema`, `LinkViewSchema`, `MembershipEndedSchema`, `MyGroupKeysSchema`, `PostChangeRequestSchema`, `PostChangeResponseSchema`, `type GroupView`; after M3b's exported types add, exactly:

```ts
export type CreateGroupRequest = z.infer<typeof CreateGroupRequestSchema>;
export type CreateInviteRequest = z.infer<typeof CreateInviteRequestSchema>;
export type InviteView = z.infer<typeof InviteViewSchema>;
export type MembershipEnded = z.infer<typeof MembershipEndedSchema>;
export type GroupDevices = z.infer<typeof GroupDevicesSchema>;
export type MyGroupKeys = z.infer<typeof MyGroupKeysSchema>;
export type GroupKeysRequest = z.infer<typeof GroupKeysRequestSchema>;
export type GroupKeysResponse = z.infer<typeof GroupKeysResponseSchema>;
export type ChangesPage = z.infer<typeof ChangesPageSchema>;
export type PostChangeRequest = z.infer<typeof PostChangeRequestSchema>;
export type BlobStored = z.infer<typeof BlobStoredSchema>;
export type CreateLinkRequest = z.infer<typeof CreateLinkRequestSchema>;
export type LinkView = z.infer<typeof LinkViewSchema>;
export type LinkRevoked = z.infer<typeof LinkRevokedSchema>;
```

and in the returned object, before `clockOffset`, exactly:

```ts
    // Groups and keys (PR 27, S2; M28).
    createGroup: (request: CreateGroupRequest): Promise<GroupView> =>
      json({ method: "POST", target: "/v1/groups", body: request, signing: "device", retry: true }, GroupViewSchema),
    groups: async (): Promise<GroupView[]> => (await json({ method: "GET", target: "/v1/groups", retry: true }, GroupListSchema)).groups,
    createInvite: (groupId: string, request: CreateInviteRequest): Promise<InviteView> =>
      json({ method: "POST", target: `/v1/groups/${encodeURIComponent(groupId)}/invites`, body: request, signing: "device", retry: true }, InviteViewSchema),
    acceptInvite: (token: string): Promise<GroupView> =>
      json({ method: "POST", target: `/v1/invites/${encodeURIComponent(token)}/accept`, signing: "device", retry: true }, GroupViewSchema),
    removeMember: (groupId: string, userId: string): Promise<MembershipEnded> =>
      json(
        { method: "DELETE", target: `/v1/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`, signing: "device", retry: true },
        MembershipEndedSchema,
      ),
    groupDevices: (groupId: string): Promise<GroupDevices> =>
      json({ method: "GET", target: `/v1/groups/${encodeURIComponent(groupId)}/devices`, retry: true }, GroupDevicesSchema),
    groupKeys: (groupId: string, deviceId: string): Promise<MyGroupKeys> =>
      json({ method: "GET", target: `/v1/groups/${encodeURIComponent(groupId)}/keys?device=${encodeURIComponent(deviceId)}`, retry: true }, MyGroupKeysSchema),
    postGroupKeys: (groupId: string, request: GroupKeysRequest): Promise<GroupKeysResponse> =>
      json({ method: "POST", target: `/v1/groups/${encodeURIComponent(groupId)}/keys`, body: request, signing: "device", retry: true }, GroupKeysResponseSchema),
    // Sync and media (PR 28, 29; M29). key: the change's own id, so a retried POST is stored once.
    changes: (groupId: string, after: number, limit?: number): Promise<ChangesPage> =>
      json(
        { method: "GET", target: `/v1/groups/${encodeURIComponent(groupId)}/changes?after=${after}${limit === undefined ? "" : `&limit=${limit}`}`, retry: true },
        ChangesPageSchema,
      ),
    postChange: async (groupId: string, request: PostChangeRequest, key: string): Promise<number> =>
      (await json({ method: "POST", target: `/v1/groups/${encodeURIComponent(groupId)}/changes`, body: request, key, retry: true }, PostChangeResponseSchema)).seq,
    uploadBlob: (groupId: string, blobId: string, locked: Uint8Array<ArrayBuffer>): Promise<BlobStored> =>
      json(
        {
          method: "POST",
          target: `/v1/blobs?group=${encodeURIComponent(groupId)}&id=${encodeURIComponent(blobId)}`,
          raw: { bytes: locked, contentType: "application/octet-stream" },
          retry: true,
        },
        BlobStoredSchema,
      ),
    blob: (blobId: string): Promise<Uint8Array<ArrayBuffer>> =>
      bytes({ method: "GET", target: `/v1/blobs/${encodeURIComponent(blobId)}`, retry: true, accept: "application/octet-stream" }),
    // The group socket's URL (PR 28). The socket needs the Clerk token in an Authorization header.
    syncSocketUrl: (groupId: string, deviceId: string): string =>
      `${options.baseUrl.replace(/^http/, "ws")}/v1/groups/${encodeURIComponent(groupId)}/sync?device=${encodeURIComponent(deviceId)}`,
    token: (): Promise<string | null> => options.getToken(),
    // Shared links (PR 30; M30b).
    createLink: (request: CreateLinkRequest): Promise<LinkView> =>
      json({ method: "POST", target: "/v1/links", body: request, signing: "device", retry: true }, LinkViewSchema),
    revokeLink: (linkId: string): Promise<LinkRevoked> =>
      json({ method: "DELETE", target: `/v1/links/${encodeURIComponent(linkId)}`, signing: "device", retry: true }, LinkRevokedSchema),
```

`test/groups-sync.test.ts`, exactly:

```ts
import { describe, expect, it } from "vitest";
import { BASE, fakeApi, jsonReply, softwareSigner } from "./helpers.ts";

const GROUP = { id: "grp_0123456789abcdef", kind: "shared", name_locked: "N".repeat(60), key_version: 1, created_by: "usr_1", role: "owner", members: [] };
const h = (sent: { init: { headers: Record<string, string> } }, name: string): string | undefined => sent.init.headers[name];

describe("groups and keys", () => {
  it("createGroup, createInvite, acceptInvite and removeMember are signed", async () => {
    const me = softwareSigner("dev_me");
    const ended = { group_id: GROUP.id, user_id: "usr_2", key_version: 2 };
    const invite = { group_id: GROUP.id, role: "editor", history_from: 0, ends_at: null, expires_at: 9 };
    const { client, sent } = fakeApi([jsonReply(201, GROUP), jsonReply(201, invite), jsonReply(200, GROUP), jsonReply(200, ended)], { device: () => me });
    expect(await client.createGroup({ id: GROUP.id, kind: "shared", name_locked: GROUP.name_locked })).toEqual(GROUP);
    expect(await client.createInvite(GROUP.id, { token_hash: "a".repeat(64), role: "editor", history_from: 0, ends_at: null })).toEqual(invite);
    expect(await client.acceptInvite("T".repeat(43))).toEqual(GROUP);
    expect(await client.removeMember(GROUP.id, "usr_2")).toEqual(ended);
    expect(sent.map((s) => [s.init.method, s.url.slice(BASE.length), h(s, "Waypoint-Device")])).toEqual([
      ["POST", "/v1/groups", "dev_me"],
      ["POST", `/v1/groups/${GROUP.id}/invites`, "dev_me"],
      ["POST", `/v1/invites/${"T".repeat(43)}/accept`, "dev_me"],
      ["DELETE", `/v1/groups/${GROUP.id}/members/usr_2`, "dev_me"],
    ]);
  });
  it("groupKeys asks for one device's envelopes", async () => {
    const { client, sent } = fakeApi([jsonReply(200, { key_version: 1, envelopes: [], signers: [] })]);
    await client.groupKeys(GROUP.id, "dev_me");
    expect(sent[0]?.url).toBe(`${BASE}/v1/groups/${GROUP.id}/keys?device=dev_me`);
  });
  it("postGroupKeys: 409 when another device's first set won", async () => {
    const me = softwareSigner("dev_me");
    const { client } = fakeApi([jsonReply(409, { code: "conflict", message: "a device already has a key for this version", retry_after: null })], { device: () => me });
    await expect(client.postGroupKeys(GROUP.id, { key_version: 1, envelopes: [{ device_id: "dev_me", wrapped_key: "E".repeat(200) }] })).rejects.toMatchObject({ status: 409 });
  });
});

describe("sync, media, links", () => {
  it("postChange is session only and uses the change id as its key", async () => {
    const { client, sent } = fakeApi([jsonReply(201, { seq: 7 })]);
    expect(await client.postChange(GROUP.id, { device_id: "dev_me", key_version: 1, kind: "session", locked_bytes: "L".repeat(44), blob_key: null }, "chg_0000000000000001")).toBe(7);
    expect(h(sent[0]!, "Idempotency-Key")).toBe("chg_0000000000000001");
    expect(h(sent[0]!, "Waypoint-Signature")).toBeUndefined();
  });
  it("changes pages after a seq", async () => {
    const { client, sent } = fakeApi([jsonReply(200, { key_version: 1, last_seq: 0, changes: [] })]);
    await client.changes(GROUP.id, 12, 100);
    expect(sent[0]?.url).toBe(`${BASE}/v1/groups/${GROUP.id}/changes?after=12&limit=100`);
  });
  it("uploadBlob sends raw octets; blob returns bytes", async () => {
    const { client, sent } = fakeApi([jsonReply(201, { id: "b".repeat(16), group_id: GROUP.id, bytes: 40 }), new Response(new Uint8Array([4, 2]))]);
    await client.uploadBlob(GROUP.id, "b".repeat(16), new Uint8Array(40));
    expect(sent[0]?.url).toBe(`${BASE}/v1/blobs?group=${GROUP.id}&id=${"b".repeat(16)}`);
    expect(h(sent[0]!, "Content-Type")).toBe("application/octet-stream");
    expect(await client.blob("b".repeat(16))).toEqual(new Uint8Array([4, 2]));
  });
  it("links are signed; the socket URL is wss", async () => {
    const me = softwareSigner("dev_me");
    const view = { id: "l".repeat(22), group_id: GROUP.id, has_passcode: false, expires_at: null, created_at: 1 };
    const { client, sent } = fakeApi([jsonReply(201, view), jsonReply(200, { id: view.id, revoked_at: 2 })], { device: () => me });
    expect(await client.createLink({ id: view.id, group_id: GROUP.id, data: "D".repeat(44), passcode: null, expires_at: null })).toEqual(view);
    expect((await client.revokeLink(view.id)).revoked_at).toBe(2);
    expect(h(sent[1]!, "Waypoint-Device")).toBe("dev_me");
    expect(client.syncSocketUrl(GROUP.id, "dev_me")).toBe(`wss://api.test/v1/groups/${GROUP.id}/sync?device=dev_me`);
  });
});
```

Checks: root `npm install`, `npm run typecheck`, `npm test`.

Not in this PR: any app code.

---

### M28a · Native: group keys in the Keychain; wrap and open with trust on first use; locked content, files and links

Branch `pr/m28a-group-keys-native`. After M27b-A. No new dependencies. Files, all under `apps/mobile/modules/waypoint-keys/`: `ios/Core/Groups.swift`, `ios/Tests/GroupTests.swift` (new), `ios/IdentityStore.swift` (one stored field), `ios/GroupOps.swift` (new), `ios/WaypointKeysModule.swift` and `src/WaypointKeys.ts` (the functions below).

Why it looks like this (`docs/security.md` sections 6, 9, 10, 11 and 19 items 5–8):
- A group key is 32 random bytes per group and key version, kept with the device's other keys in its Keychain item (`groupKeys`, keyed `"<group id>/<version>"`), never returned to JavaScript.
- **Wrapping** for a target (a device or an account row) happens only when the target is trusted: an account row whose `sign_pub` is the person's known account key, or a device whose certificate verifies under it. Untrusted targets are returned as `refused`, never wrapped for.
- **Opening** an envelope checks its signer first: the signer must be a device whose certificate verifies under the known account key of the person it claims to belong to (`GroupKeys.trusted`). `GET /v1/groups/:id/keys` lists signers without their `box_pub`, which the certificate covers, so the app passes signers from `GET /v1/groups/:id/devices` and from its own cache of signers it already checked (M28b's `trusted_signers`); see open question in section 9.
- Content is locked with `LockedContent` (M26a) under the contexts of section 11: changes `context("change", group, device, kind)`, names `context("group-name", group)`, media `context("blob", group, blob)`, links `context("link", link)` with a fresh random key and key version 0. Media are locked file to file in native code (up to 95 MB, PR 29's cap) so the bytes never cross into JavaScript.
- The recovery path opens the **account row's** envelopes with the account key (`recipientId` = the account row's id), so a recovered iPhone gets every group key back.

`ios/Core/Groups.swift`, exactly:

```swift
import CryptoKit
import Foundation

// Group keys (docs/security.md sections 6, 9 and 10). A group key is 32 random bytes per group and key version.
public enum GroupKeys {
  // A device that wrapped an envelope, as GET /v1/groups/:id/devices (or this iPhone's cache of signers it has
  // already checked) describes it.
  public struct Signer: Equatable {
    public let id: String
    public let userId: String
    public let signPub: String
    public let boxPub: String
    public let cert: String
    public init(id: String, userId: String, signPub: String, boxPub: String, cert: String) {
      self.id = id; self.userId = userId; self.signPub = signPub; self.boxPub = boxPub; self.cert = cert
    }
  }

  public static func newKey() -> Data { randomBytes(32) }

  // Trust on first use (section 6): a signer counts only if its certificate verifies under the account key this
  // iPhone already knows for that person.
  public static func trusted(_ signer: Signer, knownAccounts: [String: String]) -> Bool {
    guard let account = knownAccounts[signer.userId] else { return false }
    return DeviceCertificate.verify(accountSignPub: account, cert: signer.cert, userId: signer.userId, deviceId: signer.id, signPub: signer.signPub, boxPub: signer.boxPub)
  }

  public static func wrap(key: Data, groupId: String, keyVersion: Int, recipientId: String, recipientBoxPub: String, signerId: String, signer: some SigningKey) throws -> String {
    let info = try Envelope.groupKeyInfo(groupId: groupId, keyVersion: keyVersion, deviceId: recipientId)
    return Base64URL.encode(try Envelope.make(purpose: .groupKey, info: info, recipientBoxPub: try PublicKeys.box(recipientBoxPub), key: key, signerId: signerId, signer: signer))
  }

  // Opens one envelope addressed to recipientId (this device, or the account row this device holds). The signer must
  // be in `signers` and trusted, and its signature must verify.
  public static func open<K: HPKEDiffieHellmanPrivateKey>(
    envelope text: String, groupId: String, keyVersion: Int, recipientId: String, signers: [String: Signer], knownAccounts: [String: String], recipient: K
  ) throws -> Data {
    let parsed = try Envelope.parse(try Base64URL.decode(text))
    guard parsed.purpose == .groupKey, let signer = signers[parsed.signerId], trusted(signer, knownAccounts: knownAccounts) else { throw KeysError.badEnvelope }
    let info = try Envelope.groupKeyInfo(groupId: groupId, keyVersion: keyVersion, deviceId: recipientId)
    guard Envelope.verify(parsed, info: info, signerSignPub: try PublicKeys.signing(signer.signPub)) else { throw KeysError.badEnvelope }
    return try Envelope.open(parsed, info: info, recipient: recipient)
  }
}
```

`ios/Tests/GroupTests.swift`, exactly:

```swift
import CryptoKit
import Foundation
import Testing
@testable import KeysCore

private struct Member {
  let userId: String
  let account = P256.Signing.PrivateKey()
  let deviceSign = P256.Signing.PrivateKey()
  let deviceBox = P256.KeyAgreement.PrivateKey()
  let deviceId: String
  var signer: GroupKeys.Signer {
    let cert = try! DeviceCertificate.sign(account, userId: userId, deviceId: deviceId, signPub: deviceSign.publicKeyText, boxPub: boxKeyText(deviceBox.publicKey))
    return GroupKeys.Signer(id: deviceId, userId: userId, signPub: deviceSign.publicKeyText, boxPub: boxKeyText(deviceBox.publicKey), cert: cert)
  }
}

@Test func groupKeyWrapsAndOpensOnlyFromATrustedSigner() throws {
  let sam = Member(userId: "usr_sam", deviceId: "dev_sam")
  let ana = Member(userId: "usr_ana", deviceId: "dev_ana")
  let key = GroupKeys.newKey()
  let wrapped = try GroupKeys.wrap(key: key, groupId: "grp_0123456789abcdef", keyVersion: 2, recipientId: ana.deviceId, recipientBoxPub: boxKeyText(ana.deviceBox.publicKey), signerId: sam.deviceId, signer: sam.deviceSign)
  let known = [sam.userId: sam.account.publicKeyText]
  let signers = [sam.deviceId: sam.signer]
  #expect(try GroupKeys.open(envelope: wrapped, groupId: "grp_0123456789abcdef", keyVersion: 2, recipientId: ana.deviceId, signers: signers, knownAccounts: known, recipient: ana.deviceBox) == key)
  // Sam's account key unknown, or changed: refused before anything is opened.
  #expect(throws: KeysError.badEnvelope) {
    try GroupKeys.open(envelope: wrapped, groupId: "grp_0123456789abcdef", keyVersion: 2, recipientId: ana.deviceId, signers: signers, knownAccounts: [:], recipient: ana.deviceBox)
  }
  #expect(throws: KeysError.badEnvelope) {
    try GroupKeys.open(envelope: wrapped, groupId: "grp_0123456789abcdef", keyVersion: 2, recipientId: ana.deviceId, signers: signers, knownAccounts: [sam.userId: P256.Signing.PrivateKey().publicKeyText], recipient: ana.deviceBox)
  }
  // Another version or group does not open.
  #expect(throws: KeysError.self) {
    try GroupKeys.open(envelope: wrapped, groupId: "grp_0123456789abcdef", keyVersion: 3, recipientId: ana.deviceId, signers: signers, knownAccounts: known, recipient: ana.deviceBox)
  }
  // A signer listed under another person's account (the server lying about who it belongs to) is refused.
  let liar = GroupKeys.Signer(id: sam.deviceId, userId: ana.userId, signPub: sam.signer.signPub, boxPub: sam.signer.boxPub, cert: sam.signer.cert)
  #expect(throws: KeysError.badEnvelope) {
    try GroupKeys.open(envelope: wrapped, groupId: "grp_0123456789abcdef", keyVersion: 2, recipientId: ana.deviceId, signers: [sam.deviceId: liar], knownAccounts: [ana.userId: ana.account.publicKeyText], recipient: ana.deviceBox)
  }
}

@Test func lockedContentWithAGroupKeyRoundTrips() throws {
  let key = SymmetricKey(data: GroupKeys.newKey())
  let ctx = try context("change", ["grp_0123456789abcdef", "dev_sam", "session"])
  let locked = try LockedContent.lock(key: key, keyVersion: 4, objectContext: ctx, plaintext: Data("{}".utf8))
  #expect(try LockedContent.keyVersion(locked) == 4)
  #expect(try LockedContent.unlock(key: key, objectContext: ctx, locked: locked) == Data("{}".utf8))
  #expect(throws: KeysError.badContent) { try LockedContent.unlock(key: key, objectContext: try context("change", ["grp_0123456789abcdef", "dev_ana", "session"]), locked: locked) }
}
```

`ios/IdentityStore.swift`: in `StoredIdentity` add `var groupKeys: [String: Data]? // "<group id>/<key version>" → 32 bytes (M28a)`.

`ios/GroupOps.swift` (thin; `swiftc -typecheck` with `Core/*.swift IdentityStore.swift AccountOps.swift GroupOps.swift` on macOS), an `extension KeysOps` with these functions, each loading, changing and saving the identity under `lock` like `AccountOps.swift`:
- `makeGroupKey(userId, groupId, keyVersion)`: stores `GroupKeys.newKey()` under the slot unless one is there; returns nothing.
- `dropGroupKey(userId, groupId, keyVersion)`: removes the slot (a first set that lost the race, docs section 10).
- `heldGroupKeyVersions(userId, groupId) -> [Int]`: sorted.
- `wrapGroupKeys(userId, groupId, keyVersions: [Int], recipients: [[String: String]], knownAccounts: [String: String]) -> [String: Any]`: each recipient has `id`, `userId`, `kind`, `signPub`, `boxPub` and (devices) `cert`; trusted as above; returns `["envelopes": [["deviceId", "keyVersion", "wrappedKey"]], "refused": [ids]]`, envelopes signed by this device's Secure Enclave key under its id. A version not held throws `no_group_key`.
- `openGroupKeys(userId, groupId, recipientId, envelopes: [[String: Any]] (keyVersion, wrappedKey), signers: [[String: String]] (id, userId, signPub, boxPub, cert), knownAccounts) -> [String: Any]`: recipient key = this device's encryption key when `recipientId` is its id, the account encryption key when it is the held account row's id; stores each opened key; returns `["opened": [versions], "refused": [versions]]`. Never throws for one bad envelope.
- `lockContent(userId, groupId, keyVersion, label, fields: [String], plaintext: String) -> String` (base64url) and `unlockContent(userId, groupId, label, fields, locked: String) -> String` (UTF-8; the key version is read from the header; `no_group_key` when not held, `badContent` when it does not open). `label` is one of `change`, `group-name`, `snapshot`.
- `lockFile(userId, groupId, keyVersion, blobId, inPath, outPath) -> Int` (bytes written) and `unlockFile(userId, groupId, blobId, inPath, outPath)`: paths relative to Documents (refuse `..`), `context("blob", group, blob)`.
- `lockLink(linkId, plaintext) -> [String: String]`: `["key": base64url(32 random bytes), "data": base64url(locked)]` with key version 0 and `context("link", link id)`; no user, nothing stored.
- `KeysModuleError` gains `noGroupKey` (`"no_group_key"`).

The module and `src/WaypointKeys.ts` expose each as an `AsyncFunction` (and `heldGroupKeyVersions` as a sync `Function`) with camelCase TypeScript wrappers taking objects, following M27b-A's pattern, for example:

```ts
export type KeyTarget = { id: string; userId: string; kind: "device" | "account"; signPub: string; boxPub: string; cert: string | null };
export type WrappedFor = { deviceId: string; keyVersion: number; wrappedKey: string };
export const wrapGroupKeys = (userId: string, groupId: string, keyVersions: number[], recipients: KeyTarget[], knownAccounts: Record<string, string>): Promise<{ envelopes: WrappedFor[]; refused: string[] }> =>
  native.wrapGroupKeys(userId, groupId, keyVersions, recipients.map((r) => ({ ...r, cert: r.cert ?? "" })), knownAccounts);
```

Checks without Xcode: `npm run test:swift -w @waypoint/mobile` (the two tests above), the `swiftc -typecheck` line, root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.

Device check (run once Xcode is installed; a dev screen): make a key, lock and unlock a change; wrap for this device's own row and open it back; lock and unlock a 50 MB file (memory stays under 200 MB); `lockLink` output opens in V1's viewer (once V1 is merged).

Not in this PR: deciding when to make, wrap or open keys (M28b); sync (M29).

---
### M28b · Groups and keys: trust on first use, create, invite, accept, key distribution and rotation

Branch `pr/m28b-groups`. After M28a, M3c, M27b-C and M23 (migration order). No new dependencies. Files, all under `apps/mobile/`:
- `src/core/db/schema.ts` (migration 7), `test/migrate.test.ts` (6 → 7), `src/core/groups/keys.ts`, `src/core/groups/groups.ts`, `test/group-keys.test.ts`, `test/groups.test.ts` (new);
- `src/platform/groups.ts` (new), `src/platform/devices.ts` and `src/platform/recovery.ts` (the hooks below), `src/app/(tabs)/_layout.tsx` (one hook);
- `src/app/invite/[token].tsx` (new: the `waypoint://invite/<token>` link; screen in M30a), `src/app/_layout.tsx` (one line).

Why it looks like this (`docs/security.md` sections 6 and 10; H2's note for M28):
- **Trust on first use.** The first account key seen for a co-member is kept (`known_accounts`). If a later `GET /v1/groups/:id/devices` shows another one, it is held as *pending* and the app shows "A member's security key changed" (M30a's members screen) until the person taps "Trust the new key". Until then that member's devices are neither wrapped for nor accepted as signers. This iPhone's own person always uses the account key this iPhone holds.
- **Who wraps what** (`planKeys`): when nobody holds the group's current key version, the first set must cover every target or the server refuses it, so a device makes the key and wraps for all of them — at once if this iPhone just removed a member, otherwise after a random 0–30 s wait; on 409 it drops its key and opens the winner's. When the key exists, an owner wraps for any target missing it; anyone else only for their own devices and account row (S2 answers 409 otherwise, H2).
- **History.** A new member gets the versions the inviter's device learned at or after the invite's `history_from` (`versionsFor`; `key_versions.learned_at`), or everything when the invite said "from the start" (`history_from` 0). The server does not enforce this (R12).
- **Hooks into M27b.** Approving a new device sends envelopes for every group key version this iPhone holds (at most 500, the contract's cap). Recovering opens the account row's envelopes with the account key and wraps them for this iPhone. After this iPhone replaces the account key (a removal), it wraps every held version for the new account row.
- **Names** are locked with the group key (`context("group-name", group id)`); a group whose key has not arrived yet shows "Shared space".

`src/core/db/schema.ts`: append to `MIGRATIONS`, exactly:

```ts
  {
    version: 7,
    sql: `
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('personal', 'shared')),
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  key_version INTEGER NOT NULL CHECK (key_version >= 1),
  created_by TEXT,
  history_from INTEGER NOT NULL DEFAULT 0,
  ends_at INTEGER,
  members TEXT NOT NULL DEFAULT '[]',
  left_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE key_versions (
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  key_version INTEGER NOT NULL CHECK (key_version >= 1),
  learned_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, key_version)
);

CREATE TABLE known_accounts (
  user_id TEXT PRIMARY KEY,
  sign_pub TEXT NOT NULL,
  pending_sign_pub TEXT,
  first_seen INTEGER NOT NULL,
  changed_at INTEGER
);

CREATE TABLE trusted_signers (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  sign_pub TEXT NOT NULL,
  box_pub TEXT NOT NULL,
  cert TEXT NOT NULL
);
`,
  },
```

`src/core/groups/keys.ts`, exactly:

```ts
import type { SqlDb } from "../db/sql.ts";

// A device or account row that must hold a group's key (GET /v1/groups/:id/devices).
export type Target = {
  id: string;
  user_id: string;
  kind: "device" | "account";
  role: "owner" | "editor" | "viewer";
  sign_pub: string;
  box_pub: string;
  cert: string | null;
  has_current_key: boolean;
};

export type CertCheck = (c: { accountSignPub: string; cert: string; userId: string; deviceId: string; signPub: string; boxPub: string }) => boolean;

// Trust on first use (docs/security.md section 6). The first account key seen for a person is kept; a different one
// later is held as pending (the "security key changed" notice) until the person accepts it. This iPhone's own
// person always uses the account key it holds.
export function noteAccounts(db: SqlDb, targets: Target[], me: { userId: string; accountSignPub: string }, now: number): string[] {
  const changed: string[] = [];
  db.run(
    "INSERT INTO known_accounts (user_id, sign_pub, first_seen) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET sign_pub = excluded.sign_pub, pending_sign_pub = NULL",
    [me.userId, me.accountSignPub, now],
  );
  for (const t of targets) {
    if (t.kind !== "account" || t.user_id === me.userId) continue;
    const known = db.get<{ sign_pub: string; pending_sign_pub: string | null }>("SELECT sign_pub, pending_sign_pub FROM known_accounts WHERE user_id = ?", [t.user_id]);
    if (known === null) {
      db.run("INSERT INTO known_accounts (user_id, sign_pub, first_seen) VALUES (?, ?, ?)", [t.user_id, t.sign_pub, now]);
    } else if (known.sign_pub !== t.sign_pub && known.pending_sign_pub !== t.sign_pub) {
      db.run("UPDATE known_accounts SET pending_sign_pub = ?, changed_at = ? WHERE user_id = ?", [t.sign_pub, now, t.user_id]);
      changed.push(t.user_id);
    }
  }
  return changed;
}

// The person tapped "Trust the new key" for this member.
export function acceptNewAccountKey(db: SqlDb, userId: string): void {
  db.run("UPDATE known_accounts SET sign_pub = pending_sign_pub, pending_sign_pub = NULL WHERE user_id = ? AND pending_sign_pub IS NOT NULL", [userId]);
}

export function changedAccounts(db: SqlDb): { userId: string; changedAt: number }[] {
  return db.all<{ userId: string; changedAt: number }>(
    "SELECT user_id AS userId, changed_at AS changedAt FROM known_accounts WHERE pending_sign_pub IS NOT NULL ORDER BY changed_at",
  );
}

// user id → the account signing key this iPhone trusts for them (what waypoint-keys gets as knownAccounts).
export function knownAccounts(db: SqlDb): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of db.all<{ user_id: string; sign_pub: string }>("SELECT user_id, sign_pub FROM known_accounts")) out[r.user_id] = r.sign_pub;
  return out;
}

// A target is trusted when its row is the person's known account key, or a device certified by it.
export function isTrusted(t: Target, known: Record<string, string>, verify: CertCheck): boolean {
  const account = known[t.user_id];
  if (account === undefined) return false;
  if (t.kind === "account") return t.sign_pub === account;
  return t.cert !== null && verify({ accountSignPub: account, cert: t.cert, userId: t.user_id, deviceId: t.id, signPub: t.sign_pub, boxPub: t.box_pub });
}

// What this iPhone should do for a group's current key version (docs/security.md section 10).
export type KeyPlan =
  | { kind: "first"; recipients: Target[] } // nobody has the current version: make it and wrap for every target
  | { kind: "add"; recipients: Target[] } // wrap the held current key for targets that lack it and that we may serve
  | { kind: "blocked"; untrusted: Target[] } // a first set must cover every target, and some are not trusted
  | { kind: "none" };

export function planKeys(input: { targets: Target[]; me: { userId: string; role: "owner" | "editor" | "viewer" }; holdsCurrent: boolean; known: Record<string, string>; verify: CertCheck }): KeyPlan {
  const { targets, me, holdsCurrent, known, verify } = input;
  const nobody = targets.every((t) => !t.has_current_key);
  if (nobody && !holdsCurrent) {
    const untrusted = targets.filter((t) => !isTrusted(t, known, verify));
    return untrusted.length > 0 ? { kind: "blocked", untrusted } : { kind: "first", recipients: targets };
  }
  if (!holdsCurrent) return { kind: "none" };
  // Only an owner wraps for another member's devices (H2); anyone wraps for their own devices and account row.
  const recipients = targets.filter((t) => !t.has_current_key && (me.role === "owner" || t.user_id === me.userId) && isTrusted(t, known, verify));
  return recipients.length > 0 ? { kind: "add", recipients } : { kind: "none" };
}

// Which older key versions a new member gets: everything held when the invite said "from the start" (history_from 0),
// otherwise the versions this iPhone learned at or after history_from, and always the current one.
export function versionsFor(held: { keyVersion: number; learnedAt: number }[], historyFrom: number, current: number): number[] {
  const out = new Set<number>([current]);
  for (const h of held) if (historyFrom === 0 || h.learnedAt >= historyFrom) out.add(h.keyVersion);
  return [...out].filter((v) => held.some((h) => h.keyVersion === v)).sort((a, b) => a - b);
}

// A random wait of 0 to 30 s before making a missing key, so two devices rarely race (docs/security.md section 10).
export function firstSetDelayMs(random: () => number): number {
  return Math.floor(Math.min(0.999999, Math.max(0, random())) * 30_000);
}
```

`test/group-keys.test.ts`, exactly:

```ts
import { describe, expect, it } from "vitest";
import { migrate } from "../src/core/db/migrate.ts";
import { acceptNewAccountKey, changedAccounts, firstSetDelayMs, isTrusted, knownAccounts, noteAccounts, planKeys, versionsFor, type Target } from "../src/core/groups/keys.ts";
import { createMemoryDb } from "./helpers/db.ts";

const K = (c: string) => c.repeat(87);
function t(over: Partial<Target>): Target {
  return { id: "dev_a", user_id: "usr_a", kind: "device", role: "owner", sign_pub: K("A"), box_pub: K("B"), cert: "C".repeat(86), has_current_key: false, ...over };
}
const verify = ({ accountSignPub, cert }: { accountSignPub: string; cert: string }) => cert === "C".repeat(86) && accountSignPub !== K("X");

describe("trust on first use", () => {
  it("first sight is kept, a change is pending until accepted, our own key always wins", () => {
    const db = createMemoryDb();
    migrate(db);
    const me = { userId: "usr_me", accountSignPub: K("M") };
    expect(noteAccounts(db, [t({ kind: "account", user_id: "usr_b", sign_pub: K("S") })], me, 1)).toEqual([]);
    expect(knownAccounts(db)).toEqual({ usr_me: K("M"), usr_b: K("S") });
    expect(noteAccounts(db, [t({ kind: "account", user_id: "usr_b", sign_pub: K("T") })], me, 2)).toEqual(["usr_b"]);
    expect(noteAccounts(db, [t({ kind: "account", user_id: "usr_b", sign_pub: K("T") })], me, 3)).toEqual([]);
    expect(knownAccounts(db).usr_b).toBe(K("S"));
    expect(changedAccounts(db)).toEqual([{ userId: "usr_b", changedAt: 2 }]);
    acceptNewAccountKey(db, "usr_b");
    expect(knownAccounts(db).usr_b).toBe(K("T"));
    expect(changedAccounts(db)).toEqual([]);
    noteAccounts(db, [], { userId: "usr_me", accountSignPub: K("N") }, 4);
    expect(knownAccounts(db).usr_me).toBe(K("N"));
  });
  it("isTrusted: an account row by its key, a device by its certificate", () => {
    const known = { usr_a: K("S") };
    expect(isTrusted(t({ kind: "account", sign_pub: K("S") }), known, verify)).toBe(true);
    expect(isTrusted(t({ kind: "account", sign_pub: K("Q") }), known, verify)).toBe(false);
    expect(isTrusted(t({}), known, verify)).toBe(true);
    expect(isTrusted(t({ cert: null }), known, verify)).toBe(false);
    expect(isTrusted(t({ user_id: "usr_unknown" }), known, verify)).toBe(false);
  });
});

describe("planKeys", () => {
  const known = { usr_a: K("S"), usr_me: K("M") };
  const mine = t({ id: "dev_me", user_id: "usr_me" });
  it("nobody holds the current version: a first set for every target, unless one is untrusted", () => {
    expect(planKeys({ targets: [mine, t({})], me: { userId: "usr_me", role: "editor" }, holdsCurrent: false, known, verify })).toEqual({ kind: "first", recipients: [mine, t({})] });
    const stranger = t({ id: "dev_x", user_id: "usr_x" });
    expect(planKeys({ targets: [mine, stranger], me: { userId: "usr_me", role: "editor" }, holdsCurrent: false, known, verify })).toEqual({ kind: "blocked", untrusted: [stranger] });
  });
  it("adds: an owner serves everyone, others only their own rows", () => {
    const other = t({ id: "dev_new", user_id: "usr_a" });
    const ownNew = t({ id: "dev_me2", user_id: "usr_me" });
    const held = [t({ id: "dev_me", user_id: "usr_me", has_current_key: true }), other, ownNew];
    expect(planKeys({ targets: held, me: { userId: "usr_me", role: "owner" }, holdsCurrent: true, known, verify })).toEqual({ kind: "add", recipients: [other, ownNew] });
    expect(planKeys({ targets: held, me: { userId: "usr_me", role: "editor" }, holdsCurrent: true, known, verify })).toEqual({ kind: "add", recipients: [ownNew] });
    expect(planKeys({ targets: [t({ has_current_key: true })], me: { userId: "usr_me", role: "editor" }, holdsCurrent: false, known, verify })).toEqual({ kind: "none" });
  });
  it("versionsFor and the delay", () => {
    const held = [{ keyVersion: 1, learnedAt: 10 }, { keyVersion: 2, learnedAt: 50 }, { keyVersion: 3, learnedAt: 90 }];
    expect(versionsFor(held, 0, 3)).toEqual([1, 2, 3]);
    expect(versionsFor(held, 40, 3)).toEqual([2, 3]);
    expect(versionsFor(held, 100, 3)).toEqual([3]);
    expect(versionsFor([], 0, 1)).toEqual([]);
    expect(firstSetDelayMs(() => 0.5)).toBe(15_000);
    expect(firstSetDelayMs(() => 1)).toBeLessThan(30_000);
  });
});
```

`src/core/groups/groups.ts`: `upsertGroup(db, view: GroupView, name: string | null, now)` (keeps the stored name when `name` is null), `listGroups(db)`, `getGroup(db, id)`, `markLeft(db, id, now)` for groups no longer in `GET /v1/groups`, `noteKeyVersion(db, groupId, version, now)` (`INSERT OR IGNORE` into `key_versions`), `heldVersions(db, groupId) → { keyVersion, learnedAt }[]`, and `parseMembers(text)`. `test/groups.test.ts` covers each on `node:sqlite` (insert, update keeping the name, left groups, key versions kept once).

`src/platform/groups.ts` (the code that talks to the API and the keys module; the decisions are in the core functions above):
- `refreshGroups()`: `api.groups()`; for each group, the name via `unlockContent(user, id, "group-name", [id], name_locked)` (null when the key is missing); `upsertGroup`; groups not returned get `markLeft`. Called at launch, on app active, and by M30a's screens.
- `ensureKeys(groupId, { now: boolean })`: (1) `api.groupDevices(groupId)` and `api.groupKeys(groupId, myDeviceId)`; `noteAccounts(db, targets, me, now)`; signers = the targets' devices plus `trusted_signers` rows, matched by id; `openGroupKeys(...)` for every envelope whose version is not held; `noteKeyVersion` for each opened version; successful signers are written to `trusted_signers`. (2) `planKeys(...)` with `holdsCurrent` from `heldGroupKeyVersions` and `verify` = M27b-A's `verifyCertificate`. `first`: unless `now`, wait `firstSetDelayMs(Math.random)` and run step 1 again (someone else may have done it); then `makeGroupKey`, `wrapGroupKeys(current, all targets)`, `api.postGroupKeys(groupId, { key_version, envelopes })`; on 409, `dropGroupKey` and run step 1. `add`: for each recipient, the versions `versionsFor(heldVersions, member's history_from, current)` (own devices and own account row: every held version), one `postGroupKeys` per version (409 is ignored: someone filled the slot). `blocked`: nothing (M30a shows why).
- `createGroup(kind, name)`: `id = randomUUID()`; `makeGroupKey(user, id, 1)`; `name_locked = lockContent(user, id, 1, "group-name", [id], name)`; `api.createGroup({ id, kind, name_locked })`; `refreshGroups()`; `ensureKeys(id, { now: true })`.
- `createInvite(groupId, role, historyFrom, endsAt)`: 32 random bytes from `expo-crypto`'s `getRandomBytes(32)` as base64url (M34's `toBase64Url`) = the token; `token_hash` = `digestStringAsync(CryptoDigestAlgorithm.SHA256, token)` (lowercase hex, what PR 27 compares); `api.createInvite(...)`; returns `waypoint://invite/<token>` for the share sheet. The token is never stored on the phone.
- `acceptInvite(token)`: `api.acceptInvite(token)` (signed); `refreshGroups()`; `ensureKeys(id, { now: false })`.
- `removeMember(groupId, userId)`: `api.removeMember(...)` (the reply's `key_version` is the new one); `ensureKeys(groupId, { now: true })`. Leaving is the same call with this person's own id.
- `useGroupKeys()` (in `(tabs)/_layout.tsx`): when approved, at launch and on app active, `refreshGroups()` then `ensureKeys(id, { now: false })` for every group, one at a time.
- Hooks: `src/platform/devices.ts`'s `approveWaiting` builds `envelopes` with `wrapGroupKeys(user, groupId, heldVersions, [target], knownAccounts)` for every group (stop at 500 and wrap the rest on the new device's first `ensureKeys` — it is the same person's device, so any of their devices may add it); after `finishAccountRotation(…, true)` in `removeDevice`, each group's held versions are wrapped for the new account row and posted. `src/platform/recovery.ts`'s `recoverWithWords`, after approval: for every group, `api.groupKeys(groupId, accountId)` and `openGroupKeys(user, groupId, accountId, …)`, then `ensureKeys(groupId, { now: false })`, which wraps them for this iPhone (its own device).

Checks without Xcode: root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.

Device check (two people, three devices; run once Xcode is installed; with M30a's screens or a dev screen): person A makes a shared group: D1 has envelopes for A's device and A's account row only. A invites B ("from now"); B accepts: within a minute A's device wraps for B's device and account row. A removes B: `key_version` is 2, A's devices and account row get version 2, B's do not. B's account key changes (B removes a device): A sees "A member's security key changed" and wraps nothing for B until "Trust the new key". A approves a new device A2: A2 opens every group's names at once. A recovers on a wiped device: names and keys come back.

Not in this PR: screens (M30a); sync (M29).

---
### M29a · Sync, part A: the change format, the outbox, applying changes (core)

Branch `pr/m29a-sync-core`. After M28b. No new dependencies. Files, all under `apps/mobile/`: `src/core/db/schema.ts` (migration 8), `test/migrate.test.ts` (7 → 8), `src/core/sync/changes.ts`, `test/sync.test.ts` (new).

Why it looks like this (`docs/architecture.md` flow 4; `docs/security.md` sections 8 and 11, R8):
- **What syncs.** A space that syncs is mapped to one group (`space_groups`; a personal space gets a personal group when sync is turned on for it, M29b; a shared group gets its own space, M30a). Its sessions, segments, captures (without the file path; the file goes as a locked blob on paid plans), flags and flashcards sync. Reviews, the search index, explanations, research, overviews, made items, jobs, `sent_log` and settings stay on the device (owner question in section 9).
- **Without touching the existing screens.** SQLite triggers write every insert, update of a shared column, or delete to a `dirty` table; `collectChanges` turns those into one change per row in the `outbox`, already in plaintext JSON; M29b locks and sends them. Changes that arrive are applied with `sync_mode.applying = 1`, so the triggers ignore them and nothing echoes back.
- **Format.** The plaintext is `SyncChangeSchema` (an upsert of a row's shared columns, a delete, or the whole set of a session's segments for one source, which keeps a long transcript to one change). The room sees only `kind` (the table, `segments`, or `delete_<table>`), the device id, the key version and the size (`docs/security.md` section 16).
- **Conflicts.** Last writer wins per row, by `(at, device id)` (`row_versions`). The server can drop, delay or replay whole changes (R8); replays are ignored because they are not newer, and the change id inside the plaintext is the POST's Idempotency-Key. A received session always goes into the space this iPhone maps to that group, whatever `space_id` it carries.
- History: the server already sends only changes at or after the member's `history_from` (PR 28); nothing to do here.

`src/core/db/schema.ts`: append to `MIGRATIONS`, exactly (the `UPDATE OF` column lists are the shared columns, so local-only updates such as `indexed_at` or `last_used_at` are not sent):

```ts
  {
    version: 8,
    sql: `
CREATE TABLE space_groups (
  space_id TEXT PRIMARY KEY REFERENCES spaces (id) ON DELETE CASCADE,
  group_id TEXT NOT NULL UNIQUE REFERENCES groups (id) ON DELETE CASCADE
);

CREATE TABLE sync_state (
  group_id TEXT PRIMARY KEY REFERENCES groups (id) ON DELETE CASCADE,
  last_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  pulled_at INTEGER
);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  blob_capture_id TEXT,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX outbox_order ON outbox (created_at);

CREATE TABLE row_versions (
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  PRIMARY KEY (table_name, row_id)
);

-- Filled by the triggers below when this iPhone changes a row (plain inserts: a trigger's OR REPLACE is not reliable
-- under foreign-key actions); emptied by collectChanges, which uses each row's last entry. A deleted row keeps the
-- group it belonged to, found before it was gone.
CREATE TABLE dirty (
  seq INTEGER PRIMARY KEY,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
  group_id TEXT
);

-- 1 while applyChange writes, so changes that arrive are not sent back.
CREATE TABLE sync_mode (applying INTEGER NOT NULL CHECK (applying IN (0, 1)));
INSERT INTO sync_mode (applying) VALUES (0);

ALTER TABLE captures ADD COLUMN blob_id TEXT;

CREATE TRIGGER sync_spaces_update AFTER UPDATE OF name ON spaces WHEN (SELECT applying FROM sync_mode) = 0 BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('spaces', new.id, 0, NULL);
END;
CREATE TRIGGER sync_sessions_insert AFTER INSERT ON sessions WHEN (SELECT applying FROM sync_mode) = 0 BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('sessions', new.id, 0, NULL);
END;
CREATE TRIGGER sync_sessions_update AFTER UPDATE OF space_id, kind, title, state, transcript, started_at, ended_at, recorded_ms ON sessions WHEN (SELECT applying FROM sync_mode) = 0 BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('sessions', new.id, 0, NULL);
END;
CREATE TRIGGER sync_captures_insert AFTER INSERT ON captures WHEN (SELECT applying FROM sync_mode) = 0 BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('captures', new.id, 0, NULL);
END;
CREATE TRIGGER sync_captures_update AFTER UPDATE OF session_id, kind, t, position, duration_ms, found_text, found_lines, blob_id ON captures WHEN (SELECT applying FROM sync_mode) = 0 BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('captures', new.id, 0, NULL);
END;
CREATE TRIGGER sync_flags_insert AFTER INSERT ON flags WHEN (SELECT applying FROM sync_mode) = 0 BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('flags', new.id, 0, NULL);
END;
CREATE TRIGGER sync_flags_update AFTER UPDATE OF session_id, t, question, state ON flags WHEN (SELECT applying FROM sync_mode) = 0 BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('flags', new.id, 0, NULL);
END;
CREATE TRIGGER sync_cards_insert AFTER INSERT ON cards WHEN (SELECT applying FROM sync_mode) = 0 BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('cards', new.id, 0, NULL);
END;
CREATE TRIGGER sync_cards_update AFTER UPDATE OF session_id, kind, front, back, capture_id, t, made_by, created_at, due_at, fsrs ON cards WHEN (SELECT applying FROM sync_mode) = 0 BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('cards', new.id, 0, NULL);
END;
CREATE TRIGGER sync_sessions_delete AFTER DELETE ON sessions WHEN (SELECT applying FROM sync_mode) = 0 BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('sessions', old.id, 1, (SELECT group_id FROM space_groups WHERE space_id = old.space_id));
END;
CREATE TRIGGER sync_captures_delete AFTER DELETE ON captures WHEN (SELECT applying FROM sync_mode) = 0 BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('captures', old.id, 1, (SELECT g.group_id FROM sessions s JOIN space_groups g ON g.space_id = s.space_id WHERE s.id = old.session_id));
END;
CREATE TRIGGER sync_flags_delete AFTER DELETE ON flags WHEN (SELECT applying FROM sync_mode) = 0 BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('flags', old.id, 1, (SELECT g.group_id FROM sessions s JOIN space_groups g ON g.space_id = s.space_id WHERE s.id = old.session_id));
END;
CREATE TRIGGER sync_cards_delete AFTER DELETE ON cards WHEN (SELECT applying FROM sync_mode) = 0 BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('cards', old.id, 1, (SELECT g.group_id FROM sessions s JOIN space_groups g ON g.space_id = s.space_id WHERE s.id = old.session_id));
END;
CREATE TRIGGER sync_segments_insert AFTER INSERT ON segments WHEN (SELECT applying FROM sync_mode) = 0 BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('segments', new.session_id || ':' || new.source, 0, NULL);
END;
CREATE TRIGGER sync_segments_update AFTER UPDATE ON segments WHEN (SELECT applying FROM sync_mode) = 0 BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('segments', new.session_id || ':' || new.source, 0, NULL);
END;
CREATE TRIGGER sync_segments_delete AFTER DELETE ON segments WHEN (SELECT applying FROM sync_mode) = 0 BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('segments', old.session_id || ':' || old.source, 0, NULL);
END;
`,
  },
```

`src/core/sync/changes.ts`, exactly:

```ts
import { z } from "zod";
import type { SqlDb, SqlValue } from "../db/sql.ts";

// What one locked change says (M29a). The plaintext is this JSON; it is locked with the group key under
// context("change", group id, device id, kind) (docs/security.md section 11). kind is in clear for the room.
export const SYNC_TABLES = ["spaces", "sessions", "captures", "flags", "cards"] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

// The columns each table shares. Everything else stays on the device (files, the default space, last-used times,
// the search index). A capture's file is shared as a locked blob on paid plans (blob_id), never as a path.
export const SYNC_COLUMNS: Record<SyncTable, readonly string[]> = {
  spaces: ["id", "name", "created_at"],
  sessions: ["id", "space_id", "kind", "title", "state", "transcript", "started_at", "ended_at", "recorded_ms"],
  captures: ["id", "session_id", "kind", "t", "position", "duration_ms", "found_text", "found_lines", "blob_id"],
  flags: ["id", "session_id", "t", "question", "state"],
  cards: ["id", "session_id", "kind", "front", "back", "capture_id", "t", "made_by", "created_at", "due_at", "fsrs"],
};

const Value = z.union([z.string(), z.number(), z.null()]);
export const SyncChangeSchema = z.discriminatedUnion("op", [
  z.strictObject({ v: z.literal(1), id: z.string().min(16).max(64), at: z.number().int(), op: z.literal("upsert"), table: z.enum(SYNC_TABLES), row: z.record(z.string(), Value) }),
  z.strictObject({ v: z.literal(1), id: z.string().min(16).max(64), at: z.number().int(), op: z.literal("delete"), table: z.enum(SYNC_TABLES), row_id: z.string().min(1).max(64) }),
  z.strictObject({
    v: z.literal(1),
    id: z.string().min(16).max(64),
    at: z.number().int(),
    op: z.literal("segments"),
    session_id: z.string().min(1).max(64),
    source: z.enum(["device", "cloud"]),
    rows: z.array(z.strictObject({ t_start: z.number().int().min(0), t_end: z.number().int().min(0), text: z.string() })).max(20_000),
  }),
]);
export type SyncChange = z.infer<typeof SyncChangeSchema>;

// The room's clear kind for a change (PR 28's ChangeKindSchema: [a-z_]{1,32}).
export function changeKind(change: SyncChange): string {
  return change.op === "segments" ? "segments" : change.op === "delete" ? `delete_${change.table}` : change.table;
}

// The group a row belongs to: through its session's space (or the space itself), when that space syncs.
export function groupOf(db: SqlDb, table: SyncTable | "segments", rowId: string): string | null {
  const sql =
    table === "spaces"
      ? "SELECT group_id FROM space_groups WHERE space_id = ?"
      : table === "sessions"
        ? "SELECT g.group_id FROM sessions s JOIN space_groups g ON g.space_id = s.space_id WHERE s.id = ?"
        : "SELECT g.group_id FROM sessions s JOIN space_groups g ON g.space_id = s.space_id WHERE s.id = ?";
  const id = table === "spaces" || table === "sessions" || table === "segments" ? rowId.split(":")[0] ?? rowId : sessionOf(db, table, rowId);
  if (id === null) return null;
  return db.get<{ group_id: string }>(sql, [id])?.group_id ?? null;
}

function sessionOf(db: SqlDb, table: SyncTable, rowId: string): string | null {
  return db.get<{ session_id: string }>(`SELECT session_id FROM ${table} WHERE id = ?`, [rowId])?.session_id ?? null;
}

// Turns the rows changed on this iPhone (the dirty table, filled by triggers) into outbox entries, one per row.
// Rows in spaces that do not sync are dropped.
export function collectChanges(db: SqlDb, deps: { now: () => number; newId: () => string }): number {
  let made = 0;
  db.transaction(() => {
    const dirty = db.all<{ table_name: SyncTable | "segments"; row_id: string; deleted: number; group_id: string | null }>(
      "SELECT table_name, row_id, deleted, group_id FROM dirty WHERE seq IN (SELECT max(seq) FROM dirty GROUP BY table_name, row_id) ORDER BY seq",
    );
    for (const d of dirty) {
      const group = d.deleted === 1 ? d.group_id : groupOf(db, d.table_name, d.row_id);
      const change = group === null ? null : buildChange(db, d, deps);
      if (group !== null && change !== null) {
        db.run("INSERT INTO outbox (id, group_id, kind, body, blob_capture_id, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
          change.id,
          group,
          changeKind(change),
          JSON.stringify(change),
          change.op === "upsert" && change.table === "captures" ? (change.row.id as string) : null,
          change.at,
        ]);
        made += 1;
      }
    }
    db.run("DELETE FROM dirty");
  });
  return made;
}

function buildChange(db: SqlDb, d: { table_name: SyncTable | "segments"; row_id: string; deleted: number }, deps: { now: () => number; newId: () => string }): SyncChange | null {
  const base = { v: 1 as const, id: deps.newId(), at: deps.now() };
  if (d.table_name === "segments") {
    const [sessionId, source] = d.row_id.split(":");
    if (sessionId === undefined || (source !== "device" && source !== "cloud")) return null;
    const rows = db.all<{ t_start: number; t_end: number; text: string }>("SELECT t_start, t_end, text FROM segments WHERE session_id = ? AND source = ? ORDER BY t_start", [sessionId, source]);
    return { ...base, op: "segments", session_id: sessionId, source, rows };
  }
  if (d.deleted === 1) return { ...base, op: "delete", table: d.table_name, row_id: d.row_id };
  const columns = SYNC_COLUMNS[d.table_name];
  const row = db.get<Record<string, SqlValue>>(`SELECT ${columns.join(", ")} FROM ${d.table_name} WHERE id = ?`, [d.row_id]);
  if (row === null) return null;
  const clean: Record<string, string | number | null> = {};
  for (const c of columns) {
    const v = row[c];
    clean[c] = v instanceof Uint8Array || v === undefined ? null : v;
  }
  return { ...base, op: "upsert", table: d.table_name, row: clean };
}

// Last writer wins per row, by (at, device id). Returns true when the change is newer than what is stored.
function newer(db: SqlDb, table: string, rowId: string, at: number, deviceId: string): boolean {
  const seen = db.get<{ at: number; device_id: string }>("SELECT at, device_id FROM row_versions WHERE table_name = ? AND row_id = ?", [table, rowId]);
  if (seen !== null && (seen.at > at || (seen.at === at && seen.device_id >= deviceId))) return false;
  db.run("INSERT OR REPLACE INTO row_versions (table_name, row_id, at, device_id) VALUES (?, ?, ?, ?)", [table, rowId, at, deviceId]);
  return true;
}

// Applies one unlocked change from the group's log to this iPhone's tables, without marking anything dirty. A
// session always goes into the space this iPhone maps to the group. Returns false when it was older or not usable.
export function applyChange(db: SqlDb, groupId: string, change: SyncChange, deviceId: string): boolean {
  const space = db.get<{ space_id: string }>("SELECT space_id FROM space_groups WHERE group_id = ?", [groupId])?.space_id;
  if (space === undefined) return false;
  let applied = false;
  db.transaction(() => {
    db.run("UPDATE sync_mode SET applying = 1");
    try {
      const key = change.op === "segments" ? `${change.session_id}:${change.source}` : change.op === "delete" ? change.row_id : String(change.row.id ?? "");
      const table = change.op === "segments" ? "segments" : change.table;
      if (key === "" || !newer(db, table, key, change.at, deviceId)) return;
      if (change.op === "delete") {
        if (change.table !== "spaces") db.run(`DELETE FROM ${change.table} WHERE id = ?`, [change.row_id]);
      } else if (change.op === "segments") {
        if (db.get("SELECT 1 AS ok FROM sessions WHERE id = ? AND space_id = ?", [change.session_id, space]) === null) return;
        db.run("DELETE FROM segments WHERE session_id = ? AND source = ?", [change.session_id, change.source]);
        for (const r of change.rows) {
          db.run("INSERT OR IGNORE INTO segments (session_id, t_start, t_end, text, source) VALUES (?, ?, ?, ?, ?)", [change.session_id, r.t_start, Math.max(r.t_start, r.t_end), r.text, change.source]);
        }
      } else if (change.table === "spaces") {
        if (typeof change.row.name === "string") db.run("UPDATE spaces SET name = ? WHERE id = ?", [change.row.name.slice(0, 60) || "Shared space", space]);
      } else {
        const row: Record<string, string | number | null> = {};
        for (const c of SYNC_COLUMNS[change.table]) row[c] = change.row[c] ?? null;
        if (change.table === "sessions") row.space_id = space;
        const columns = Object.keys(row);
        const extra = change.table === "captures" ? ", file" : "";
        const values = columns.map((c) => row[c] ?? null);
        if (change.table === "captures") values.push("");
        const updates = columns.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ");
        db.run(
          `INSERT INTO ${change.table} (${columns.join(", ")}${extra}) VALUES (${values.map(() => "?").join(", ")}) ON CONFLICT (id) DO UPDATE SET ${updates}`,
          values,
        );
      }
      applied = true;
    } finally {
      db.run("UPDATE sync_mode SET applying = 0");
    }
  });
  return applied;
}

export type Outgoing = { id: string; groupId: string; kind: string; body: string; blobCaptureId: string | null };

export function nextOutgoing(db: SqlDb, limit = 50): Outgoing[] {
  return db.all<Outgoing>(
    "SELECT id, group_id AS groupId, kind, body, blob_capture_id AS blobCaptureId FROM outbox ORDER BY created_at, id LIMIT ?",
    [limit],
  );
}

export function sent(db: SqlDb, id: string): void {
  db.run("DELETE FROM outbox WHERE id = ?", [id]);
}

export function lastSeq(db: SqlDb, groupId: string): number {
  return db.get<{ last_seq: number }>("SELECT last_seq FROM sync_state WHERE group_id = ?", [groupId])?.last_seq ?? 0;
}

export function setLastSeq(db: SqlDb, groupId: string, seq: number, now: number): void {
  db.run(
    "INSERT INTO sync_state (group_id, last_seq, pulled_at) VALUES (?, ?, ?) ON CONFLICT (group_id) DO UPDATE SET last_seq = max(last_seq, excluded.last_seq), pulled_at = excluded.pulled_at",
    [groupId, seq, now],
  );
}
```

`test/sync.test.ts`, exactly:

```ts
import { describe, expect, it } from "vitest";
import { savePart, saveSegment, startRecordingSession } from "../src/core/capture/recording.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { createSpace, ensureDefaultSpace } from "../src/core/db/spaces.ts";
import { applyChange, collectChanges, lastSeq, nextOutgoing, sent, setLastSeq, SyncChangeSchema } from "../src/core/sync/changes.ts";
import { createMemoryDb } from "./helpers/db.ts";

function device() {
  const db = createMemoryDb();
  migrate(db);
  let n = 0;
  const deps = { now: () => 1_000 + n, newId: () => `id_${String(++n).padStart(16, "0")}` };
  ensureDefaultSpace(db, deps);
  const space = createSpace(db, deps, "Biology");
  db.run("INSERT INTO groups (id, kind, role, key_version, updated_at) VALUES ('grp_0123456789abcdef', 'personal', 'owner', 1, 0)");
  db.run("INSERT INTO space_groups (space_id, group_id) VALUES (?, 'grp_0123456789abcdef')", [space.id]);
  db.run("DELETE FROM dirty");
  return { db, deps, space };
}
const G = "grp_0123456789abcdef";

describe("collecting changes", () => {
  it("rows in a synced space become one change each; other spaces are ignored", () => {
    const { db, deps, space } = device();
    const s = startRecordingSession(db, deps, space.id, true);
    saveSegment(db, s.id, { tStart: 0, tEnd: 10, text: "cells" });
    saveSegment(db, s.id, { tStart: 10, tEnd: 20, text: "divide" });
    const other = startRecordingSession(db, deps, ensureDefaultSpace(db, deps).id, true);
    saveSegment(db, other.id, { tStart: 0, tEnd: 1, text: "private" });
    expect(collectChanges(db, deps)).toBe(2);
    const out = nextOutgoing(db).map((o) => ({ kind: o.kind, body: SyncChangeSchema.parse(JSON.parse(o.body)) }));
    expect(out.map((o) => o.kind).sort()).toEqual(["segments", "sessions"]);
    const seg = out.find((o) => o.kind === "segments")?.body;
    expect(seg?.op === "segments" && seg.rows.map((r) => r.text)).toEqual(["cells", "divide"]);
    expect(JSON.stringify(out)).not.toContain("private");
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM dirty")?.n).toBe(0);
  });
  it("a deleted session keeps its group; sent entries leave the outbox", () => {
    const { db, deps, space } = device();
    const s = startRecordingSession(db, deps, space.id, true);
    collectChanges(db, deps);
    for (const o of nextOutgoing(db)) sent(db, o.id);
    db.run("DELETE FROM sessions WHERE id = ?", [s.id]);
    collectChanges(db, deps);
    const out = nextOutgoing(db);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("delete_sessions");
    expect(out[0]?.groupId).toBe(G);
  });
  it("a capture names its row for the blob upload", () => {
    const { db, deps, space } = device();
    const s = startRecordingSession(db, deps, space.id, true);
    savePart(db, deps, s.id, { index: 0, startMs: 0, durationMs: 5, file: "a.m4a" });
    collectChanges(db, deps);
    expect(nextOutgoing(db).find((o) => o.kind === "captures")?.blobCaptureId).not.toBeNull();
  });
});

describe("applying changes", () => {
  it("applies into the group's space, never marks rows dirty, and keeps the newest", () => {
    const a = device();
    const b = device();
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, s.id, { tStart: 0, tEnd: 10, text: "cells" });
    collectChanges(a.db, a.deps);
    const changes = nextOutgoing(a.db).map((o) => SyncChangeSchema.parse(JSON.parse(o.body)));
    const session = changes.find((c) => c.op === "upsert");
    const segments = changes.find((c) => c.op === "segments");
    if (session === undefined || session.op !== "upsert" || segments === undefined) throw new Error("expected both changes");
    expect(applyChange(b.db, G, session, "dev_a")).toBe(true);
    expect(applyChange(b.db, G, segments, "dev_a")).toBe(true);
    expect(b.db.get<{ space_id: string; title: string }>("SELECT space_id, title FROM sessions WHERE id = ?", [s.id])).toEqual({ space_id: b.space.id, title: "New recording" });
    expect(b.db.get<{ text: string }>("SELECT text FROM segments WHERE session_id = ?", [s.id])?.text).toBe("cells");
    expect(b.db.get<{ n: number }>("SELECT count(*) AS n FROM dirty")?.n).toBe(0);
    expect(applyChange(b.db, G, session, "dev_a")).toBe(false);
    expect(applyChange(b.db, G, { ...session, at: session.at + 5, row: { ...session.row, title: "Mitosis" } }, "dev_a")).toBe(true);
    expect(b.db.get<{ title: string }>("SELECT title FROM sessions WHERE id = ?", [s.id])?.title).toBe("Mitosis");
    expect(applyChange(b.db, "grp_unknown_0000000", session, "dev_a")).toBe(false);
  });
  it("last seq only moves forward", () => {
    const { db } = device();
    setLastSeq(db, G, 9, 1);
    setLastSeq(db, G, 4, 2);
    expect(lastSeq(db, G)).toBe(9);
  });
});
```

Checks: root `npm install`, `npm run typecheck`, `npm test`.

Not in this PR: locking, sending, receiving, the socket, blobs (M29b).

---

### M29b · Sync, part B: send, pull after `seq`, the socket, sync pushes, media blobs

Branch `pr/m29b-sync`. After M29a. Dependency: `expo-task-manager` **58.0.13** (published 2026-10-31; SDK 58 asks for `~58.0.13`), for the background task that handles silent `sync` pushes. Files, all under `apps/mobile/`: `package.json`, `app.json` (the `expo-notifications` plugin entry becomes `["expo-notifications", { "enableBackgroundRemoteNotifications": true }]`), `src/platform/sync.ts` (new), `src/core/push/push.ts` and `test/push.test.ts` (`sync` → `{ kind: "sync", groupId }`), `src/platform/push.ts` (one action), `src/app/(tabs)/_layout.tsx` (one hook), `src/features/capture/SpaceScreen.tsx` (the "Sync this space" switch), `src/platform/files.ts` (`blobTempPath`).

Why it looks like this (flow 4; PR 28, PR 29):
- **Send.** `collectChanges`, then for each outbox entry: `lockContent(user, group, current key version, "change", [group, myDeviceId, kind], body)` → `api.postChange(group, { device_id, key_version, kind, locked_bytes, blob_key }, entry.id)` → `sent(db, id)`. 409 "key version is not current" → `ensureKeys(group, { now: false })` and try again later (nothing is written with a key a removed member knows). A capture whose file exists and whose plan is paid: lock the file (`lockFile`, blob id = a new UUID) into a temporary file, `api.uploadBlob(group, blobId, bytes)`, set the capture's `blob_id` (that update queues the capture again with the id), and the change carries `blob_key = groups/<group>/media/<blob>`. `plan_required` (403 from PR 29 for a free plan) → the capture syncs without its file and the space screen says "Photos and audio sync on paid plans."
- **Pull.** `api.changes(group, lastSeq)` pages (100 at a time, up to 4 MB) until `changes` is empty; each change: `unlockContent(user, group, "change", [group, change.device_id, change.kind], locked_bytes)` → `SyncChangeSchema.parse(JSON.parse(text))` → `applyChange(db, group, change, change.device_id)`; a change that does not open or parse is skipped (logged nowhere with content); `setLastSeq` after each page. A change whose `kind` does not match its plaintext op is skipped.
- **Media down.** After a pull, captures with a `blob_id` and an empty `file`: `api.blob(blobId)` → write to a temporary file → `unlockFile` into `sessions/<session>/<capture id>.<ext>` → set `file`. Up to 3 at a time, Wi-Fi or not.
- **The socket.** While the app is active, one `WebSocket(api.syncSocketUrl(group, myDeviceId), undefined, { headers: { Authorization: `Bearer ${token}` } })` per synced group. Each `{"type":"changed","last_seq":n}` with `n > lastSeq` triggers a pull; after a pull it sends `{"type":"ack","seq":lastSeq}`. Close code 4003 (membership ended) → `refreshGroups()` and no reconnect; 4000 (replaced) → no reconnect; anything else → reconnect after 2, 5, 15, 30 s. Closed when the app goes to the background.
- **Pushes.** Devices without an open socket get a silent `sync` push at most once a minute (PR 28). `TaskManager.defineTask("waypoint-sync", …)` at module scope and `Notifications.registerTaskAsync("waypoint-sync")` run one send-and-pull for the group in `ref` (iOS gives about 30 s).
- **Turning sync on** for a space (M29b's switch on `SpaceScreen`, "Sync with my other devices"): `createGroup("personal", space name)` and a `space_groups` row, then every existing row of the space is marked dirty once (`INSERT INTO dirty … SELECT` per table) so it is sent. Turning it off is not offered in this card (the group stays; open question in section 9).

Checks without Xcode: root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.

Device check (two iPhones of the same person; run once Xcode is installed):
1. Turn on sync for a space on A: the space appears on B within seconds (socket), with its sessions and transcripts.
2. Rename a session on B: A shows the new title. Edit the same session on both while offline, then go online: the later edit wins on both.
3. Delete a session on A: it disappears on B.
4. With B in the background (no socket): a change on A wakes B by a silent push; opening B shows it without waiting.
5. On a paid plan: a photo appears on B; on a free plan it shows "Photos and audio sync on paid plans." `POST /v1/blobs` needs `Content-Length` (the route answers 400 without it, and `api.uploadBlob` sets none, trusting `fetch`): if the photo never arrives, check the API log for that 400; React Native's `fetch` must send the length for a `Uint8Array` body (PR #101 review).
6. D1 and the room hold no readable text: the room's `locked_bytes` are not JSON.

Not in this PR: shared groups and their screens (M30a); deleting media from R2 (open question 37); snapshots and log compaction (no server card yet).

---
### M30a · Share bundle, part A: shared spaces, invites, members, leaving

Branch `pr/m30a-share-groups`. After M29b. Files, all under `apps/mobile/`: `src/features/share/SharedSpaceScreen.tsx`, `src/features/share/InviteScreen.tsx`, `src/features/share/JoinScreen.tsx`, `src/features/share/NewSharedSpaceScreen.tsx` (new); `src/app/shared/[id].tsx`, `src/app/shared/new.tsx`, `src/app/shared/invite.tsx`, `src/app/invite/[token].tsx` (M28b's stub becomes the join screen); `src/app/_layout.tsx` (three lines); `src/core/share/spaces.ts`, `test/share-spaces.test.ts` (new); `src/platform/share.ts` (new); `src/features/capture/SpacesScreen.tsx` (a "Shared spaces" section and a "New shared space" button).

Why it looks like this (I1–I9, E9; `docs/architecture.md` flow 4; PR 27; open questions 39–43):
- A **shared space** is a shared group mapped to a local space (`space_groups`), so it shows next to the person's own spaces and sync (M29) does the rest. Making one: `createGroup("shared", name)` (M28b), a new local space with that name, the mapping.
- **Inviting** (owners only, PR 27): role Editor or Viewer; history "From now" or "Everything so far" (`history_from` now or 0); access "No end", "1 week", "1 month" or "3 months" (`ends_at`; never for an owner). The invite is a `waypoint://invite/<token>` link handed to the iOS share sheet (`Share.share`). It works once and lasts 7 days. The token is never stored on the phone. Invite links in a URL path may be logged by Workers observability (open question 43).
- **Joining** (`/invite/[token]`): "Join this shared space?" → `acceptInvite` → a local space named from the group's locked name (or "Shared space" until the key arrives), the mapping, and "Waiting for a key from the owner…" until `ensureKeys` opens it.
- **Members** (`SharedSpaceScreen`): the members (user ids; the server has no names, open question 42; the app shows "You", "Owner", or "Member 1, 2…" by join order), each with role and, when set, "Access ends `date`". An owner can remove a member ("They keep what they already saw. New notes use a new key."), which bumps the key version (M28b makes the new key at once). Anyone can leave (the same call with their own id; the last owner cannot, PR 27). Leaving keeps the local copy (a caption says so) and removes the mapping.
- **"A member's security key changed"** (TOFU, M28b): a banner per member with a pending key, "Their notes are not shared with their new key until you check. Compare the safety code with them, or tap Trust if you know they changed devices." with "Trust the new key" (`acceptNewAccountKey`). The safety code is the first 12 characters of the SHA-256 of the pending `sign_pub`, in groups of 4 (`src/core/share/spaces.ts`'s `safetyCode`, tested).
- **Blocked keys**: when M28b's plan is `blocked`, the screen says "Waiting for members to check a changed security key."

`src/core/share/spaces.ts`: `memberLabels(members, me)` (You / Owner / Member n by `starts_at`), `inviteEnds(choice, now)` (`null`, +7, +30, +90 days in ms), `safetyCode(hexSha256)` (`"abcd efgh ijkl"`), `canInvite(role)`, `canRemove(myRole, target)`. `test/share-spaces.test.ts` covers each, including that an owner invite never gets an end date.

`src/platform/share.ts`: `newSharedSpace(name)`, `invite(groupId, role, history, ends) → url`, `join(token)`, `leave(groupId)`, `removeMember(groupId, userId)`, `pendingKeyChanges()`. The SHA-256 for the safety code uses `expo-crypto`'s `digestStringAsync`.

Checks without Xcode: root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.

Device check (two people; run once Xcode is installed): A makes a shared space and invites B as Editor "from now"; B opens the link from Messages, joins, and sees new notes from A within seconds but none from before the invite; B's edits reach A; A removes B: B's socket closes, B keeps old notes, and A's next note is under key version 2; B cannot read it. An invite with "1 week" shows "Access ends …" for B.

Not in this PR: shared links and moving a note (M30b); group deletion, role changes (open question 41); revoking a removed member's links (open question 39).

---

### V1 · The shared-link web viewer (`apps/viewer`, served by the API Worker)

Branch `pr/v1-viewer`. After PR 30 (merged). Dependency: `esbuild` **0.28.2** (published 2026-08-08; the version wrangler 4.164.0 already installs, so the lockfile gains no new copy), dev only, in `apps/viewer`. Files:
- `packages/contracts/src/shared.ts` (new), `packages/contracts/src/index.ts` (one `export *` line), `packages/contracts/test/shared.test.ts` (new);
- `apps/viewer/package.json`, `tsconfig.json`, `test/tsconfig.json`, `build.mjs`, `static/viewer.html`, `static/viewer.css`, `src/unlock.ts`, `src/item.ts`, `src/main.ts`, `test/unlock.test.ts` (new);
- `apps/api/src/links/viewer.ts`, `apps/api/test/viewer.test.ts` (new), `apps/api/src/app.ts` (one import, one route line), `apps/api/src/env.ts` (one line), `apps/api/wrangler.jsonc` (the `assets` block), `apps/api/package.json` (the `bundle` script);
- `docs/build-plan.md` "Owner setup" is **not** changed by this card (section 2 of this file lists the site key step; the reconciling PR copies it).

Why it looks like this (`docs/security.md` sections 11 and 15, R10; `docs/architecture.md` "Workers static assets"; open question 38):
- `GET /l/:id` serves one HTML page from Workers static assets, through the Worker so it carries a strict Content-Security-Policy (`script-src 'self'` plus Turnstile's origin, `connect-src 'self'`, no framing) and `Referrer-Policy: no-referrer`. The page's script reads the key from `#k=<base64url of 32 bytes>`, which browsers never send, imports it as a non-extractable `CryptoKey`, wipes the bytes, and **removes the fragment from the address bar before anything else loads**. It fetches `GET /v1/links/:id/data` (same origin, no session), unlocks it with WebCrypto AES-256-GCM under `context("link", link id)` and key version 0, checks its shape, and shows it with `textContent` only.
- **No other code**: the viewer re-implements only `context()`, strict base64url and the 17-byte content header (about 60 lines, `src/unlock.ts`), so the page does not load `@waypoint/crypto` (its HPKE code) or zod (about 430 KB); tests check it against `packages/crypto`'s published vector and its `lockContent`, and check the hand-written shape check against `SharedItemSchema`. The built script is about 5 KB.
- **Turnstile and R10**: a passcode link needs a Turnstile token (PR 30). Its script is a third-party script in the page that holds the key, which `docs/security.md` says the viewer should not load. V1 loads it **only for passcode links, only after the key is imported non-extractable and gone from the URL**. That still lets a compromised Turnstile script read the page's text; the stricter fix (the widget in a sandboxed iframe on another origin, passing the token by `postMessage`) is open question 38 for the security reviewer.
- The shared item format is defined here (`SharedItemSchema`: one session as text — title, date, transcript lines with times, page text; no audio or images in version 1) because the viewer and M30b must agree on it.
- **Build**: `npm run build -w @waypoint/viewer` writes `apps/viewer/dist/` (git-ignored by the root `dist/` rule). The API's `bundle` script builds it first, because `wrangler` needs the `assets` directory to exist. `TURNSTILE_SITE_KEY` comes from the environment at build time; without it the build uses Cloudflare's always-passing test site key `1x00000000000000000000AA` (development only).

`packages/contracts/src/shared.ts`, exactly:

```ts
import { z } from "zod";

// What a shared link unlocks to (V1, M30): one session, as text. Locked with the link key and
// context("link", link id), key version 0 (docs/security.md section 11). No audio, no images in version 1.
export const SHARED_TEXT_MAX_CHARS = 400_000;

export const SharedItemSchema = z.strictObject({
  v: z.literal(1),
  kind: z.literal("session"),
  title: z.string().min(1).max(200),
  created_at: z.number().int().min(0),
  transcript: z.array(z.strictObject({ t: z.number().int().min(0), text: z.string().max(10_000) })).max(20_000),
  pages: z.array(z.strictObject({ text: z.string().max(50_000) })).max(200),
});
export type SharedItem = z.infer<typeof SharedItemSchema>;
```

`packages/contracts/src/index.ts`: add `export * from "./shared.ts";`. `packages/contracts/test/shared.test.ts`, exactly:

```ts
import { describe, expect, it } from "vitest";
import { SharedItemSchema } from "../src/index.ts";

const ITEM = { v: 1, kind: "session", title: "Biology", created_at: 1, transcript: [{ t: 0, text: "Cells divide." }], pages: [{ text: "Page one" }] };

describe("SharedItemSchema", () => {
  it("accepts a session item", () => {
    expect(SharedItemSchema.parse(ITEM)).toEqual(ITEM);
  });
  it("refuses extra keys, another version, an empty title and negative times", () => {
    expect(SharedItemSchema.safeParse({ ...ITEM, notes: "x" }).success).toBe(false);
    expect(SharedItemSchema.safeParse({ ...ITEM, v: 2 }).success).toBe(false);
    expect(SharedItemSchema.safeParse({ ...ITEM, title: "" }).success).toBe(false);
    expect(SharedItemSchema.safeParse({ ...ITEM, transcript: [{ t: -1, text: "x" }] }).success).toBe(false);
  });
});
```

`apps/viewer/package.json`, exactly:

```json
{
  "name": "@waypoint/viewer",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.mjs",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json && tsc -p test/tsconfig.json"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "5.20261118.1",
    "@types/node": "24.19.2",
    "@waypoint/contracts": "0.0.0",
    "@waypoint/crypto": "0.0.0",
    "esbuild": "0.28.2"
  }
}
```

`apps/viewer/tsconfig.json` (the page: DOM types, no Node) and `apps/viewer/test/tsconfig.json` (the tests: Node and Workers types, plus the two plain files they test), exactly:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["es2022", "dom"], "types": [] },
  "include": ["src"]
}
```

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "types": ["@cloudflare/workers-types", "node"] },
  "include": [".", "../src/unlock.ts", "../src/item.ts"]
}
```

`apps/viewer/build.mjs`, exactly:

```js
import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";

// Builds the viewer into dist/ for Workers static assets (apps/api/wrangler.jsonc "assets"). TURNSTILE_SITE_KEY comes
// from the environment; without it, Cloudflare's always-passing test key is used (development only).
const siteKey = process.env.TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA";
if (!/^[0-9A-Za-z_-]{1,64}$/.test(siteKey)) throw new Error("bad TURNSTILE_SITE_KEY");
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/viewer", { recursive: true });
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2022",
  legalComments: "none",
  outfile: "dist/viewer/viewer.js",
  define: { TURNSTILE_SITE_KEY: JSON.stringify(siteKey) },
});
copyFileSync("static/viewer.html", "dist/viewer.html");
copyFileSync("static/viewer.css", "dist/viewer/viewer.css");
```

`apps/viewer/static/viewer.html`, exactly:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>Waypoint</title>
<link rel="stylesheet" href="/viewer/viewer.css">
<script type="module" src="/viewer/viewer.js"></script>
</head>
<body>
<main id="app"><p class="muted">Opening…</p></main>
<noscript>This page needs JavaScript to unlock what was shared.</noscript>
</body>
</html>
```

`apps/viewer/static/viewer.css`, exactly:

```css
:root { color-scheme: light dark; --ink: #1c1c1e; --muted: #6e6e73; --bg: #ffffff; --accent: #2f6fde; }
@media (prefers-color-scheme: dark) { :root { --ink: #f2f2f7; --muted: #98989f; --bg: #000000; --accent: #6a9cff; } }
body { margin: 0; background: var(--bg); color: var(--ink); font: 17px/1.5 -apple-system, system-ui, sans-serif; }
main { max-width: 680px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 28px; line-height: 1.2; }
.muted { color: var(--muted); font-size: 15px; }
.time { color: var(--accent); font-variant-numeric: tabular-nums; margin-right: 4px; }
.page { white-space: pre-wrap; }
.error { color: #d70015; }
form { display: grid; gap: 12px; max-width: 320px; }
input, button { font: inherit; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--muted); }
button { background: var(--accent); color: #fff; border: 0; }
```

`apps/viewer/src/unlock.ts`, exactly:

```ts
// Opening a shared link in the browser with WebCrypto only (docs/security.md sections 4, 11 and 15). The same
// formats as packages/crypto, written again here so the page loads no other code; test/unlock.test.ts checks them
// against packages/crypto's published vectors and its lockContent.

// The link key from the URL fragment "#k=<base64url of 32 bytes>". The fragment never reaches the server.
export function keyFromFragment(hash: string): Uint8Array<ArrayBuffer> | null {
  const match = /^#k=([A-Za-z0-9_-]{43})$/.exec(hash);
  if (match === null) return null;
  const key = fromBase64Url(match[1] ?? "");
  return key !== null && key.length === 32 ? key : null;
}

// The link id from the path /l/<id> (PR 30's LinkIdSchema).
export function linkIdFromPath(path: string): string | null {
  return /^\/l\/([A-Za-z0-9_-]{22,64})$/.exec(path)?.[1] ?? null;
}

// Strict base64url without padding; null when the text is not the canonical encoding.
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  let back = "";
  for (const b of bytes) back += String.fromCharCode(b);
  return btoa(back).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") === text ? bytes : null;
}

// context(label, f1, ...) = "waypoint/v1/" ‖ label ‖ 0x00 ‖ u16(len f1) ‖ f1 ‖ ... (docs/security.md section 4).
export function context(label: string, ...fields: string[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const parts = [enc.encode(`waypoint/v1/${label}`), new Uint8Array([0])];
  for (const field of fields) {
    const bytes = enc.encode(field);
    if (bytes.length > 0xffff) throw new RangeError("field too long");
    parts.push(new Uint8Array([bytes.length >> 8, bytes.length & 0xff]), bytes);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// Imported so the key cannot be read back (extractable false). Call before any other script loads.
export function importLinkKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
}

// Locked content: u8 1 | u32 key version | nonce (12) | ciphertext ‖ tag; AAD = the 17 header bytes ‖ the context.
// null for anything that does not open (wrong key, another link's data, damage, a key version that is not 0).
export async function unlock(key: CryptoKey, objectContext: Uint8Array<ArrayBuffer>, locked: Uint8Array<ArrayBuffer>, keyVersion = 0): Promise<Uint8Array<ArrayBuffer> | null> {
  if (locked.length < 33 || locked[0] !== 1) return null;
  if (new DataView(locked.buffer, locked.byteOffset).getUint32(1, false) !== keyVersion) return null;
  const head = locked.slice(0, 17);
  const aad = new Uint8Array(17 + objectContext.length);
  aad.set(head, 0);
  aad.set(objectContext, 17);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: head.slice(5), additionalData: aad }, key, locked.slice(17)));
  } catch {
    return null;
  }
}
```

`apps/viewer/src/item.ts`, exactly:

```ts
// The shape of a shared item (SharedItemSchema in packages/contracts/src/shared.ts), checked by hand so the page
// does not load zod. test/item.test.ts keeps the two in step.
export type SharedItem = {
  v: 1;
  kind: "session";
  title: string;
  created_at: number;
  transcript: { t: number; text: string }[];
  pages: { text: string }[];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const only = (o: Obj, keys: string[]): boolean => Object.keys(o).every((k) => keys.includes(k)) && keys.every((k) => k in o);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const str = (v: unknown, min: number, max: number): v is string => typeof v === "string" && v.length >= min && v.length <= max;

export function checkSharedItem(value: unknown): SharedItem | null {
  if (!isObj(value) || !only(value, ["v", "kind", "title", "created_at", "transcript", "pages"])) return null;
  if (value.v !== 1 || value.kind !== "session" || !str(value.title, 1, 200) || !isInt(value.created_at)) return null;
  const { transcript, pages } = value;
  if (!Array.isArray(transcript) || transcript.length > 20_000 || !Array.isArray(pages) || pages.length > 200) return null;
  for (const line of transcript) if (!isObj(line) || !only(line, ["t", "text"]) || !isInt(line.t) || !str(line.text, 0, 10_000)) return null;
  for (const page of pages) if (!isObj(page) || !only(page, ["text"]) || !str(page.text, 0, 50_000)) return null;
  return { v: 1, kind: "session", title: value.title, created_at: value.created_at, transcript: transcript as SharedItem["transcript"], pages: pages as SharedItem["pages"] };
}
```

`apps/viewer/src/main.ts`, exactly:

```ts
// The shared-link viewer (V1). It reads the link key from the URL fragment, which browsers never send, unlocks the
// item with WebCrypto, and shows it as text. It loads no other script, except Cloudflare Turnstile for a passcode link.
import { checkSharedItem, type SharedItem } from "./item.ts";
import { context, importLinkKey, keyFromFragment, linkIdFromPath, unlock } from "./unlock.ts";

declare const TURNSTILE_SITE_KEY: string; // set by build.mjs from the environment

type Turnstile = {
  render(el: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }): string;
  reset(widget: string): void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className !== undefined) node.className = className;
  return node;
}

function show(...nodes: HTMLElement[]): void {
  document.getElementById("app")?.replaceChildren(...nodes);
}

function message(title: string, body: string): void {
  show(el("h1", title), el("p", body));
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function render(item: SharedItem): void {
  const nodes: HTMLElement[] = [el("h1", item.title), el("p", new Date(item.created_at).toLocaleDateString(), "muted")];
  if (item.transcript.length > 0) {
    nodes.push(el("h2", "Transcript"));
    for (const line of item.transcript) {
      const p = el("p");
      p.append(el("span", clock(line.t), "time"), document.createTextNode(` ${line.text}`));
      nodes.push(p);
    }
  }
  if (item.pages.length > 0) {
    nodes.push(el("h2", "Pages"));
    item.pages.forEach((page, i) => nodes.push(el("h3", `Page ${i + 1}`), el("p", page.text, "page")));
  }
  nodes.push(el("p", "Shared from Waypoint. Only people with this link can open it.", "muted"));
  show(...nodes);
}

let turnstileLoading: Promise<Turnstile> | null = null;

// Loaded only for a passcode link, after the key is imported and gone from the address bar (docs/security.md R10).
function loadTurnstile(): Promise<Turnstile> {
  turnstileLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_URL;
    script.async = true;
    script.onload = () => (window.turnstile === undefined ? reject(new Error("turnstile")) : resolve(window.turnstile));
    script.onerror = () => reject(new Error("turnstile"));
    document.head.append(script);
  });
  return turnstileLoading;
}

async function askPasscode(id: string, key: CryptoKey, note: string | null): Promise<void> {
  const form = el("form");
  const input = el("input");
  input.type = "password";
  input.autocomplete = "off";
  input.maxLength = 64;
  input.placeholder = "Passcode";
  const check = el("div");
  const button = el("button", "Open");
  button.type = "submit";
  form.append(input, check, button);
  show(el("h1", "This link has a passcode"), el("p", "Ask the person who shared it."), ...(note === null ? [] : [el("p", note, "error")]), form);
  let token = "";
  let widget = "";
  try {
    const turnstile = await loadTurnstile();
    widget = turnstile.render(check, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (t) => (token = t),
      "expired-callback": () => (token = ""),
      "error-callback": () => (token = ""),
    });
  } catch {
    message("Couldn't load the check", "Reload the page to try again.");
    return;
  }
  form.onsubmit = (event) => {
    event.preventDefault();
    if (input.value === "" || token === "") return;
    const headers = { "Waypoint-Link-Passcode": input.value, "Waypoint-Turnstile": token };
    token = "";
    window.turnstile?.reset(widget); // a token works once
    void load(id, key, headers);
  };
}

async function load(id: string, key: CryptoKey, headers: Record<string, string>): Promise<void> {
  let reply: Response;
  try {
    reply = await fetch(`/v1/links/${id}/data`, { headers, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
  } catch {
    message("You're offline", "Connect to the internet and reload the page.");
    return;
  }
  if (reply.status === 401) {
    const body: unknown = await reply.json().catch(() => null);
    const wrong = typeof body === "object" && body !== null && "message" in body && body.message === "wrong passcode";
    await askPasscode(id, key, wrong ? "That passcode isn't right." : null);
    return;
  }
  if (reply.status === 403) return askPasscode(id, key, "The check didn't work. Try again.");
  if (reply.status === 404) return message("This link doesn't work anymore", "It was turned off, or it expired.");
  if (reply.status === 429) return message("Too many tries", "Wait a minute, then reload the page.");
  if (!reply.ok) return message("Something went wrong", "Try again later.");
  const plain = await unlock(key, context("link", id), new Uint8Array(await reply.arrayBuffer()));
  let item: SharedItem | null = null;
  try {
    item = plain === null ? null : checkSharedItem(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain)));
  } catch {
    item = null;
  }
  if (item === null) return message("This link can't be opened", "Part of the link is missing or changed. Ask for the link again.");
  render(item);
}

async function run(): Promise<void> {
  const id = linkIdFromPath(location.pathname);
  const raw = keyFromFragment(location.hash);
  if (id === null || raw === null) return message("This link is incomplete", "Ask for the whole link again. It ends with #k= and a long code.");
  const key = await importLinkKey(raw);
  raw.fill(0);
  // The key leaves the address bar (and history) before anything else loads.
  history.replaceState(null, "", location.pathname);
  await load(id, key, {});
}

void run();
```

`apps/viewer/test/unlock.test.ts`, exactly:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SharedItemSchema } from "@waypoint/contracts";
import { context as refContext, importContentKey, lockContent, toBase64Url } from "@waypoint/crypto";
import { describe, expect, it } from "vitest";
import { checkSharedItem } from "../src/item.ts";
import { context, fromBase64Url, importLinkKey, keyFromFragment, linkIdFromPath, unlock } from "../src/unlock.ts";

const vectors = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../packages/crypto/test/vectors/waypoint-v1.json"), "utf8"));
const hex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));

describe("unlock", () => {
  it("opens the published content vector", async () => {
    const c = vectors.content;
    const key = await importLinkKey(hex(c.key));
    const out = await unlock(key, context(c.context_label, ...c.context_fields), fromBase64Url(c.locked)!, c.key_version);
    expect(new TextDecoder().decode(out!)).toBe(c.plaintext_utf8);
    expect(await unlock(key, context(c.context_label, ...c.context_fields), fromBase64Url(c.locked)!, 0)).toBeNull();
  });
  it("matches packages/crypto: context, and a link locked there", async () => {
    expect(context("link", "lnk_abcdefghijklmnopqrstuv")).toEqual(refContext("link", "lnk_abcdefghijklmnopqrstuv"));
    const raw = new Uint8Array(32).fill(5);
    const locked = await lockContent(await importContentKey(raw), 0, refContext("link", "L".repeat(22)), new TextEncoder().encode("hi"), new Uint8Array(12));
    const key = await importLinkKey(raw);
    expect(new TextDecoder().decode((await unlock(key, context("link", "L".repeat(22)), new Uint8Array(locked)))!)).toBe("hi");
    expect(await unlock(key, context("link", "M".repeat(22)), new Uint8Array(locked))).toBeNull();
    expect(await unlock(await importLinkKey(new Uint8Array(32)), context("link", "L".repeat(22)), new Uint8Array(locked))).toBeNull();
  });
  it("reads the fragment and the path strictly", () => {
    const k = toBase64Url(new Uint8Array(32).fill(1));
    expect(keyFromFragment(`#k=${k}`)).toEqual(new Uint8Array(32).fill(1));
    expect(keyFromFragment(`#k=${k}x`)).toBeNull();
    expect(keyFromFragment(`#k=${k.slice(0, -1)}B`)).toBeNull(); // not canonical
    expect(keyFromFragment("")).toBeNull();
    expect(linkIdFromPath(`/l/${"a".repeat(22)}`)).toBe("a".repeat(22));
    expect(linkIdFromPath("/l/short")).toBeNull();
  });
});

describe("checkSharedItem agrees with SharedItemSchema", () => {
  const good = { v: 1, kind: "session", title: "Biology", created_at: 5, transcript: [{ t: 0, text: "cells" }], pages: [{ text: "p" }] };
  const cases: unknown[] = [good, { ...good, extra: 1 }, { ...good, v: 2 }, { ...good, title: "" }, { ...good, transcript: [{ t: -1, text: "" }] }, { ...good, pages: [{ text: "x", y: 1 }] }, null, [], "x"];
  it.each(cases.map((c, i) => [i, c]))("case %i", (_i, value) => {
    expect(checkSharedItem(value) !== null).toBe(SharedItemSchema.safeParse(value).success);
  });
});
```

`apps/api/src/links/viewer.ts`, exactly:

```ts
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";

// The page's only script is its own; Turnstile's script and frame are allowed for passcode links (docs/security.md
// section 15, R10). Nothing else loads, and no other site may frame the page.
export const VIEWER_CSP =
  "default-src 'none'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; " +
  "connect-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// GET /l/:id: the shared-link viewer (V1), from Workers static assets. The key stays in the URL fragment, which the
// browser never sends.
export function viewerRoute() {
  return new Hono<AppEnv>().get("/l/:id", async (c) => {
    if (!/^[A-Za-z0-9_-]{22,64}$/.test(c.req.param("id"))) throw new ApiFailure("not_found", "no such link");
    const page = await c.env.ASSETS.fetch(new Request(new URL("/viewer.html", c.req.url)));
    if (!page.ok) throw new ApiFailure("internal", "viewer unavailable");
    return new Response(page.body, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": VIEWER_CSP,
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  });
}
```

`apps/api/src/app.ts`: add `import { viewerRoute } from "./links/viewer.ts";` and, as the last route line, `app.route("/", viewerRoute());`. The path is outside `/v1/*`, so no session or Idempotency-Key middleware runs. `apps/api/src/env.ts`: append `ASSETS: Fetcher;` to `Env`. `apps/api/wrangler.jsonc`: add, just above `"durable_objects"`, exactly:

```jsonc
  "assets": { "directory": "../viewer/dist", "binding": "ASSETS", "html_handling": "none", "not_found_handling": "none" },
```

(Assets are matched first; `/l/<id>` matches no file, so the Worker runs and serves `viewer.html` itself with the headers. `html_handling: "none"` keeps `/viewer.html` from redirecting. `/viewer/viewer.js` and `/viewer/viewer.css` are served straight from assets.) `apps/api/package.json`: `"bundle": "npm run build --prefix ../viewer && wrangler deploy --dry-run --outdir dist"`.

`apps/api/test/viewer.test.ts`, exactly:

```ts
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import { VIEWER_CSP, viewerRoute } from "../src/links/viewer.ts";

function app() {
  const a = new Hono<AppEnv>();
  a.onError(handleError);
  a.route("/", viewerRoute());
  return a;
}
const LINK = "a".repeat(22);
const assets = (status: number) => ({
  fetch: async (request: Request) => (new URL(request.url).pathname === "/viewer.html" ? new Response("<html>viewer</html>", { status }) : new Response("no", { status: 404 })),
});
const envWith = (status: number) => ({ ASSETS: assets(status) });

describe("GET /l/:id", () => {
  it("serves the viewer page with its security headers", async () => {
    const res = await app().request(`/l/${LINK}`, {}, envWith(200));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>viewer</html>");
    expect(res.headers.get("Content-Security-Policy")).toBe(VIEWER_CSP);
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("a malformed id is 404 without reading assets", async () => {
    const res = await app().request("/l/short", {}, envWith(200));
    expect(res.status).toBe(404);
  });
  it("missing assets is 500", async () => {
    const res = await app().request(`/l/${LINK}`, {}, envWith(404));
    expect(res.status).toBe(500);
  });
});
```

Checks: root `npm install`, `npm run typecheck`, `npm test` (viewer 12 tests, API 3 more, contracts 2 more), `npm run bundle -w @waypoint/api` (its output lists `env.ASSETS  Assets`).

Manual check (no Xcode; `wrangler dev` with a local D1 and the dummy Turnstile keys): make a link with the crypto package in a scratch Node script (`lockContent` with a random key, `context("link", id)`, version 0; `POST /v1/links` needs a signed request, so insert the `links` row and the R2 object directly in the local dev state), open `http://localhost:8787/l/<id>#k=<key>`: the item shows and the address bar no longer has the fragment; change one character of the key: "This link can't be opened"; set a passcode hash on the row: the passcode form and Turnstile's test widget appear, a wrong passcode says "That passcode isn't right."; revoke: "This link doesn't work anymore". The browser's network panel shows only `viewer.html`, `viewer.js`, `viewer.css`, the data call and, for the passcode link only, `challenges.cloudflare.com`.

Not in this PR: making links in the app (M30b); images or audio in links; a Turnstile iframe on a separate origin (open question 38).

---

### M30b · Share bundle, part B: shared links, moving a note into a shared space, key history

Branch `pr/m30b-shared-links`. After M30a and V1. Files, all under `apps/mobile/`: `src/core/db/schema.ts` (migration 9), `test/migrate.test.ts` (8 → 9), `src/core/share/links.ts`, `test/links.test.ts` (new); `src/core/sync/changes.ts` (`markMoved`, and its test in `test/sync.test.ts`); `src/platform/links.ts` (new); `src/features/share/ShareSessionScreen.tsx`, `src/features/share/KeyHistoryScreen.tsx` (new); `src/app/share/[sessionId].tsx`, `src/app/shared/keys.tsx` (new), `src/app/_layout.tsx` (two lines); `src/features/capture/SessionScreen.tsx` (menu item "Share a link"), `src/features/share/SharedSpaceScreen.tsx` (a "Key history" row), `src/features/capture/SpacePickerScreen.tsx` (moving into a shared space).

Why it looks like this (I5–I8, E9; PR 30; `docs/security.md` sections 11 and 15, R10):
- **A link** shows one session to anyone who has the URL, read-only, in a browser (V1). The app builds the `SharedItemSchema` JSON from the session (title, date, the device transcript as `{ t, text }` lines, page text), locks it natively with a **new random key** (`lockLink`, M28a), and sends only the locked bytes (`POST /v1/links`, signed; at most 4 MiB, so a longer transcript is cut and the screen says so). The URL is `<EXPO_PUBLIC_API_URL>/l/<link id>#k=<key>`; the key never reaches the server. Optional passcode (4–64 printable characters) and expiry (none, 1 day, 1 week, 1 month).
- PR 30 ties every link to a group the person may write to. A session in a space that does not sync is linked through one personal group per person named "Shared links", made on first use and **not** mapped to a space, so making a link never starts syncing a space.
- The `links` table keeps each link's URL **on this phone only** (it contains the key) so it can be copied again or revoked (`DELETE /v1/links/:id`, signed). Deleting the session revokes its links first.
- **Moving a note** into a shared space (the existing "Move to another space" picker now lists shared spaces, with "Everyone in `space` will see this session."): the move updates `sessions.space_id`, and `markMoved(db, sessionId, oldGroupId)` marks every row of the session dirty for the new group and adds a delete for the old group (if it synced), so devices that are only in the old group drop their copy.
- **Key history** (`KeyHistoryScreen`): the group's key versions this iPhone holds with the date each was learned ("Key 3 · since 12 Nov"), and the current version; a caption explains that a new key starts when someone leaves or is removed, so they cannot read what comes after.

`src/core/db/schema.ts`, migration 9, exactly:

```ts
  {
    version: 9,
    sql: `
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions (id) ON DELETE SET NULL,
  group_id TEXT NOT NULL,
  url TEXT NOT NULL,
  has_passcode INTEGER NOT NULL CHECK (has_passcode IN (0, 1)),
  expires_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX links_session ON links (session_id, created_at);
`,
  },
```

`src/core/share/links.ts`: `sharedItem(db, sessionId, maxBytes = 4_000_000) → { item: SharedItem; cut: boolean } | null` (drops transcript lines from the end until `utf8Length(JSON.stringify(item))` fits, using M15's `utf8Length`; null for a missing session), `linkUrl(apiUrl, linkId, key)`, `recordLink(db, …)`, `linksForSession(db, sessionId)`, `markRevoked(db, id, at)`, `expiryFor(choice, now)`. `test/links.test.ts` checks that `sharedItem` output passes `SharedItemSchema`, that a long transcript is cut and reported, that `linkUrl` puts the key only after `#k=`, and that deleting the session keeps the link row with `session_id` null (so it can still be revoked).

`src/platform/links.ts`: `createLink(sessionId, { passcode, expires })`: the session's group (`space_groups`) or the "Shared links" group (`createGroup("personal", "Shared links")` once, its id kept in settings); link id = `toBase64Url(getRandomBytes(16))` (22 characters, `LinkIdSchema`); `lockLink(linkId, JSON.stringify(item))`; `api.createLink({ id, group_id, data, passcode, expires_at })`; `recordLink`; returns the URL for `Share.share({ url })`. `revokeLink(id)`: `api.revokeLink(id)` then `markRevoked`. Failures use M15's `toFailure`.

Screens: **`ShareSessionScreen`** (`/share/[sessionId]`): "Share a link" — "Anyone with the link can read this session's transcript and page text in a web browser. They can't change it or see anything else." A passcode switch with a field, expiry choices, "Make link"; then the URL with "Share…" and "Copy" (`expo-clipboard` is not added: the share sheet has Copy); existing links listed with "Turn off" (revoke). When the item was cut: "The transcript was too long; the link has the first part." **`KeyHistoryScreen`** (`/shared/keys?groupId=`).

Checks without Xcode: root `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`.

Device check (run once Xcode is installed; V1 deployed to the same API): share a session from a non-synced space: no space starts syncing; the link opens in Safari on another device and shows the transcript; with a passcode it asks for it; "Turn off" makes it show "This link doesn't work anymore"; move a session into a shared space: the other member sees it, and a device only in the old space loses it.

Not in this PR: links to a whole space; images or audio in links; revoking links when a member is removed (open question 39).

---

### M2a · Spike (time-boxed, 2 days): Module Federation and Zephyr on SDK 58's Metro

Branch `spike/m2a-zephyr`. **Not merged** (report in the PR, then closed). Needs Xcode, a device, a Zephyr Cloud account and a `ZE_CI_TOKEN`. Run once Xcode is installed, and **not before 2026-11-25** (see the versions below).

What is known (checked 19 Nov 2026 on npm and GitHub):
- `@module-federation/metro` 2.9.3 (2026-11-03) still declares Metro `^0.82.1` (and `@expo/metro-runtime ^5`, the SDK 53 line). SDK 58 pins Metro **0.87.1** exactly (`@expo/metro@58.0.0`). Its compatibility layer (module-federation/core PR 4418) reads `metro/private/*`, which 0.87 exports, so the peer range may be stale rather than a hard block; npm needs `overrides` to install it. Nothing upstream says Expo or expo-router is supported (the Expo support PR 4080 was closed unmerged); `withModuleFederation` replaces Expo's serializer.
- `zephyr-metro-plugin`, `zephyr-native-cache` and `zephyr-agent`: 1.7.0 (2026-10-18) is the newest at least 14 days old. **1.8.0 (2026-11-11)** adds `runtimeManifest` (the host following an environment tag at run time, which `docs/architecture.md`'s release rules need); it becomes 14 days old on **2026-11-25**. Use 1.8.0 then.
- `zephyr-native-cache` checks each bundle's SHA-256 against the manifest, but **fails open**: on a mismatch it deletes the file and loads the bundle from the network without a check; cache hits are not re-hashed; the hash comes from the same CDN, so it checks integrity, not origin. `docs/architecture.md` says bundles are "checked by SHA-256": this needs a patch or fork that fails closed.
- Remotes run by `eval()` of JavaScript text in Hermes (not bytecode), which costs start-up time. expo-router finds routes at build time, so routes stay in the host and remotes export screen components.

Time box: **2 working days**.

Steps:
1. A scratch copy of the app on the branch: `@module-federation/metro@2.9.3` and `@module-federation/metro-plugin-rnc-cli@2.9.3` with root `overrides` holding Metro at 0.87.1 (`npm ls metro` shows one copy). The host is the shell (`src/app`, `src/shell`, `src/ui`, `src/platform`, `src/core`, every native module); one remote exposes the Study feature's screens (`src/features/study`), shared singletons `react`, `react-native`, `expo-router`, `expo`.
2. Development: the remote's screen renders inside its host route under `expo start`.
3. Release build with Hermes on the iPhone: the Xcode bundle phase changed to the federation host bundle command; the remote loads; list what broke when Expo's serializer was replaced (assets, source maps, `EXPO_PUBLIC_*` inlining).
4. Zephyr 1.8.0: `withZephyr`, publish the remote with `ZE_ENV=ios-0.1.0-internal`, the host following it with `runtimeManifest`; republish a visible change; the host shows it on the second cold start, never during a recording (M5's recording state checked before applying).
5. `zephyr-native-cache`: change a published bundle's bytes; check what happens; try a small patch that refuses the bundle and keeps the cached one.

**Go** only if: a Hermes release build on the iPhone runs the host and a remote; an update arrives without a store build and applies on the next cold start; a tampered bundle never runs (with our patch, which must be small enough to keep); start-up time grows by at most 300 ms on the oldest test iPhone; `EXPO_PUBLIC_*` values and assets still work. Otherwise **no-go**: feature bundles keep shipping inside the store build (as now), and M2 waits for upstream Expo support.

Report: the go or no-go, versions, every patch needed, the changed build steps, start-up times, and the outline for M2b.

---

## 7. Outlines (written in full later)

**M2b · Over-the-air bundles with Zephyr** (only if M2a says go). One Module Federation remote per `src/features/*` folder (capture, study, search, settings, explain, plans, jobs, research, overviews, made, share) plus `src/shell`; native modules (above all `waypoint-keys` and `waypoint-sandbox`) only in store builds; one Zephyr environment per native version (`ios-<expo.version>`), internal tag first, then production; the native cache patched to fail closed; applied on the next cold start, never during a recording; CI publishing with `ZE_CI_TOKEN`. Written from M2a's report.

**M31 · sqlite-vec on iOS** once expo/expo#43455 ships the iOS framework (or a patch): replace M9a's TypeScript vector scan with the extension, same `search_index` data. Still open upstream on 19 Nov 2026.

**M32 · Component tests with `jest-expo`** if screens grow logic that `src/core` cannot hold. Not needed yet: every card above keeps its decisions in `src/core` and tests them in Node.

**M35 · System targets** (was M30 in the earlier outlines): Home Screen widgets (B5), a Live Activity and Dynamic Island while recording (C10), and the share extension (E8), with shared state in an App Group, through `expo-widgets` (SDK 58 asks for `~58.0.27`; published 2026-11-03) or a config plugin adding Swift targets. The share extension only hands content to the app; it never holds or uses keys, and the widgets show no note text on the lock screen. Written after stage 4.

---
## 8. Build order

Added to "Build order" in `docs/build-plan.md` as mobile batches M-i to M-r. A card starts when the cards in its "after" column are merged; within a batch, merge in the order given. Migrations land in number order (section 0).

| Mobile batch | Cards (after) | Merge order |
|---|---|---|
| M-i | M27b-A (M27a, merged), M3b (M3, merged) | M27b-A, M3b |
| M-j | M27b-B (M27b-A, M3b) | M27b-B |
| M-k | M27b-C (M27b-B, M20) | M27b-C |
| M-l | M34 (M3b, M15, M20) — after stage 2's M15, M16, M20, M21 | M34 |
| M-m | M18 (M34), M19 (M34, M16), M25a (M34) | M18, M19, M25a |
| M-n | M22a spike (Xcode); M22b (M22a) | M22b |
| M-o | M23 (M22b, M25a); M24a (M23); M24b (M24a); M25b (M25a) | M23, M24a, M24b, M25b |
| M-p | M3c (M3b); M28a (M27b-A); V1 (PR 30, merged; any time) | M3c, M28a, V1 |
| M-q | M28b (M28a, M3c, M27b-C, M23); M29a (M28b); M29b (M29a) | M28b, M29a, M29b |
| M-r | M30a (M29b); M30b (M30a, V1); M2a spike (Xcode, from 2026-11-25) | M30a, M30b |

Why this order: the recovery key comes first (open question 46): before real purchases, a student must be able to get a new iPhone approved. M27b-A and M3b touch different packages and run side by side. M34 needs M15's `sent_log` and failure copy, so the job cards follow stage 2. M25a takes migration 5 ahead of M23 because M23 waits for the voice spike. M28b needs M27b-C's approval code (it adds group envelopes to it). V1 is server and viewer only and can be built any time; M30b needs it to test links end to end.

**Xcode.** Every card above can be written, type-checked, tested in Node, bundled and have its Swift `Core` tested without Xcode, except the two spikes, which are all device work. Device checks are marked "not run: no Xcode yet" until the build Mac is upgraded, and run in card order afterwards. M25b's gate is a hard gate: mini apps stay off (KV flag) until it has passed on a real iPhone.

## 9. Decisions and open questions for the owner

Decisions taken in these cards (say if any should change):

1. **M27b first, split in three.** Native work (M27b-A), recovery key screens and recovering without a device (M27b-B), then devices, the code, removal and sign-out cleanup (M27b-C). The recovery prompt opens once per launch while an approved iPhone holding the account key has no recovery key on the server; "Later" is allowed.
2. **The new account key on removal is pending** in the Keychain until the server accepts it; on "devices changed, try again" it is dropped and the list reloads. Other devices take a replaced account key only from a device they already knew (`known_devices`), the pairing approver, or themselves.
3. **Push payload fix in M27b-C.** The server puts `kind`/`ref` at the top level of the APNs payload, but `expo-notifications` exposes only the payload's `body` key as `data`; M20's tap handling never matched. M27b-C reads the raw payload from the push trigger. (Alternative: the server nests them under `body`; not chosen, it would change PR 31's tests.)
4. **One jobs plumbing card (M34)** with a device `jobs` table, because there is no `GET /v1/jobs` list. Job types register savers and routes; nothing else changes per type.
5. **"Always" for the second transcript** means "offer the sheet after each recording", never sending without a tap (each send costs credits). True automatic sending is one line.
6. **Voices are rendered to files**, not spoken live (pausable, seekable, lock-screen playback, reused under videos). Apple's voices ship first (M22b); Kokoro is a separate card (M22c) only if the spike says go. The cloud fallback voice (MeloTTS, `fallback_voice`) is not built and the app never sends `fallback_voice: true`; every iOS 26 iPhone can use Apple's voices.
7. **Video** is rendered on the phone at 1280×720 with one frame per slide; no cloud renderer.
8. **Mini apps and diagrams** run only in our own native web view module (`waypoint-sandbox`), not `react-native-webview`, with four layers of blocking and a device gate; mini apps stay behind the KV flag `mini_app_viewer` until the gate passes. Mermaid 12.3.0's browser bundle is shipped in the app (5.5 MB, MIT).
9. **Sync model.** One group per synced space; row-level last-writer-wins changes collected by SQLite triggers (no edits to existing screens); a session's segments travel as one change; reviews, explanations, research, overviews, made items and jobs stay on the device; captures' files travel as locked blobs on paid plans only.
10. **Links** use one personal group per person named "Shared links" (PR 30 requires a group), so sharing a link never starts syncing a space. A link holds one session as text only.
11. **V1** re-implements the 60 lines of crypto it needs instead of bundling `@waypoint/crypto` and zod (5 KB page instead of about 500 KB), with tests tying it to the published vectors.
12. **Numbering**: M28 groups and keys, M29 sync, M30 sharing, M35 system targets; M3b/M3c and M34 are new.

Open questions (also to be added to "Open questions" in `docs/build-plan.md` when these cards are reconciled):

1. **Kokoro**: go or no-go comes from M22a. If no-go, is Apple's voices only acceptable for launch (question 51)? If go, where is the voice pack hosted (an R2 custom domain is assumed)?
2. **Zephyr**: wait for 1.8.0 (2026-11-25) for the spike, as planned, or allow an exception to the 14-day rule? And the native cache fails open on a bad hash: is maintaining a small patch acceptable, or should over-the-air updates wait?
3. **Sync scope**: should flashcard reviews (scheduling) sync too? Should turning sync off for a space be offered (the group would stay on the server)? Snapshots and log compaction still have no server card (question 37).
4. **Group signers' `box_pub`**: `GET /v1/groups/:id/keys` lists signers without `box_pub`, which their certificates cover, so M28 verifies signers through `GET /v1/groups/:id/devices` and a local cache. A removed signer that this iPhone never saw cannot be checked, so its envelopes are refused. A one-line server change (add `box_pub` to `signers`) would remove the cache. Make it?
5. **Turnstile in the viewer** (question 38, R10): accept loading it in the key's page for passcode links (after the key is made non-extractable and removed from the URL), or require a Turnstile iframe on a separate origin before passcode links ship?
6. **Member names** (question 42): the app shows "Member 1, 2…". A locked profile change per member in each group would let names show; worth a card?
7. **Safety codes**: M30a shows a 12-character code for a member whose key changed. Should the app also show everyone's code for comparing in person (not required by `docs/security.md`)?
8. **Removed device, recovery key**: after a removal, the old recovery words stop working (the blob is deleted) and the app asks for new ones once per launch. Is a stronger nudge needed for students who skip it (R14)?
9. **Mermaid in the app**: 5.5 MB in the binary. Acceptable, or download it like the voice pack?
10. **Practice answers**: short answers are self-marked when they do not match exactly. Should they be checked by the on-device model instead (Apple Intelligence phones only)?
