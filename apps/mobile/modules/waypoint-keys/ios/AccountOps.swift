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
    identity.pendingAccountId = nil // a key this device made for a removal is never needed after a recovery
    identity.pendingAccountKey = nil
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
    identity.pendingAccountId = nil // adopted: any key this device made for a removal is now the account key or retired
    identity.pendingAccountKey = nil
    try IdentityStore.save(identity, userId: userId)
  }

  // Removing an approved device (docs/security.md section 12): a new account key, kept pending, with its own
  // certificate (selfCert), and a certificate and an account-key envelope (signed by this device) for every device
  // that stays.
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
    let selfCert = try key.selfCertificate(userId: userId, accountId: try checkId(accountId))
    return ["account": ["id": accountId, "signPub": key.signPub, "boxPub": key.boxPub, "selfCert": selfCert], "devices": out]
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
