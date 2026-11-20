import CryptoKit
import Foundation

// M28a: group keys in the Keychain, wrapping and opening them, and locked content, files and links
// (docs/security.md sections 6, 9, 10 and 11). Thin: the formats are in Core/. Every change to the Keychain item
// runs inside KeysOps.lock; locking and unlocking only read it.
extension KeysOps {
  // The Keychain slot of one group key: "<group id>/<key version>" (StoredIdentity.groupKeys).
  private static func slot(groupId: String, keyVersion: Int) throws -> String {
    guard keyVersion >= 1 else { throw KeysError.badInput }
    return "\(try checkId(groupId))/\(keyVersion)"
  }

  private static func groupKey(_ identity: StoredIdentity, groupId: String, keyVersion: Int) throws -> SymmetricKey {
    guard let key = identity.groupKeys?[try slot(groupId: groupId, keyVersion: keyVersion)] else { throw KeysModuleError.noGroupKey }
    return SymmetricKey(data: key)
  }

  // The AAD context of locked content: the group id first, then the caller's fields (docs/security.md section 11).
  private static func objectContext(_ label: String, groupId: String, fields: [String]) throws -> Data {
    guard ["change", "group-name", "snapshot"].contains(label) else { throw KeysError.badLabel }
    return try context(label, [try checkId(groupId)] + fields)
  }

  // A path under Documents. Relative only, and no ".." part.
  private static func documentsURL(_ path: String) throws -> URL {
    guard !path.isEmpty, !path.hasPrefix("/"), !path.split(separator: "/", omittingEmptySubsequences: false).contains("..") else {
      throw KeysError.badInput
    }
    return try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: false).appendingPathComponent(path)
  }

  // Stores a new random key for this group and version, unless one is there already.
  static func makeGroupKey(userId: String, groupId: String, keyVersion: Int) throws {
    lock.lock(); defer { lock.unlock() }
    var stored = try identity(userId)
    let at = try slot(groupId: groupId, keyVersion: keyVersion)
    var keys = stored.groupKeys ?? [:]
    guard keys[at] == nil else { return }
    keys[at] = GroupKeys.newKey()
    stored.groupKeys = keys
    try IdentityStore.save(stored, userId: userId)
  }

  // Removes one group key (a first set that lost the race, docs/security.md section 10).
  static func dropGroupKey(userId: String, groupId: String, keyVersion: Int) throws {
    lock.lock(); defer { lock.unlock() }
    var stored = try identity(userId)
    let at = try slot(groupId: groupId, keyVersion: keyVersion)
    guard stored.groupKeys?[at] != nil else { return }
    stored.groupKeys?[at] = nil
    try IdentityStore.save(stored, userId: userId)
  }

  // The versions of this group whose keys this device holds, sorted.
  static func heldGroupKeyVersions(userId: String, groupId: String) throws -> [Int] {
    let stored = try identity(userId)
    let prefix = "\(try checkId(groupId))/"
    return (stored.groupKeys ?? [:]).keys.compactMap { key -> Int? in
      guard key.hasPrefix(prefix) else { return nil }
      return Int(key.dropFirst(prefix.count))
    }.sorted()
  }

  // Wraps the held keys for each recipient that is trusted (docs/security.md section 6): an account row whose sign
  // key is the person's known account key and whose own certificate verifies under it, or a device whose certificate
  // verifies under it. Others are refused.
  static func wrapGroupKeys(userId: String, groupId: String, keyVersions: [Int], recipients: [[String: String]], knownAccounts: [String: String]) throws -> [String: Any] {
    let stored = try identity(userId)
    let signer = try IdentityStore.signingKey(stored)
    let keys = stored.groupKeys ?? [:]
    // Every requested version must be held before anything is wrapped.
    let pairs = try keyVersions.map { version -> (Int, Data) in
      guard let key = keys[try slot(groupId: groupId, keyVersion: version)] else { throw KeysModuleError.noGroupKey }
      return (version, key)
    }
    var envelopes: [[String: Any]] = []
    var refused: [String] = []
    for recipient in recipients {
      guard let id = recipient["id"], let personId = recipient["userId"], let kind = recipient["kind"], let signPub = recipient["signPub"],
        let boxPub = recipient["boxPub"], let cert = recipient["cert"]
      else { throw KeysError.badInput }
      let trusted: Bool
      switch kind {
      case "account": trusted = GroupKeys.trustedAccount(id: id, userId: personId, signPub: signPub, boxPub: boxPub, cert: cert, knownAccounts: knownAccounts)
      case "device": trusted = GroupKeys.trusted(GroupKeys.Signer(id: id, userId: personId, signPub: signPub, boxPub: boxPub, cert: cert), knownAccounts: knownAccounts)
      default: throw KeysError.badInput
      }
      guard trusted else {
        refused.append(id)
        continue
      }
      for (version, key) in pairs {
        let wrapped = try GroupKeys.wrap(key: key, groupId: groupId, keyVersion: version, recipientId: id, recipientBoxPub: boxPub, signerId: stored.deviceId, signer: signer)
        envelopes.append(["deviceId": id, "keyVersion": version, "wrappedKey": wrapped])
      }
    }
    return ["envelopes": envelopes, "refused": refused]
  }

  // Opens the group-key envelopes addressed to recipientId (this device, or the account row this device holds) and
  // stores each key that opens. A bad envelope is refused, not thrown; the signers must be trusted (section 6).
  static func openGroupKeys(
    userId: String, groupId: String, recipientId: String, envelopes: [[String: Any]], signers: [[String: String]], knownAccounts: [String: String]
  ) throws -> [String: Any] {
    lock.lock(); defer { lock.unlock() }
    var stored = try identity(userId)
    var trustedSigners: [String: GroupKeys.Signer] = [:]
    for signer in signers {
      guard let id = signer["id"], let personId = signer["userId"], let signPub = signer["signPub"], let boxPub = signer["boxPub"],
        let cert = signer["cert"]
      else { throw KeysError.badInput }
      trustedSigners[id] = GroupKeys.Signer(id: id, userId: personId, signPub: signPub, boxPub: boxPub, cert: cert)
    }
    let toDevice = recipientId == stored.deviceId
    guard toDevice || recipientId == stored.accountId else { throw KeysError.badInput }
    var accountBox: P256.KeyAgreement.PrivateKey?
    if !toDevice { accountBox = try heldAccount(stored).key.box }
    var keys = stored.groupKeys ?? [:]
    var opened: [Int] = []
    var refused: [Int] = []
    for envelope in envelopes {
      guard let version = envelope["keyVersion"] as? Int, let text = envelope["wrappedKey"] as? String else { throw KeysError.badInput }
      let at = try slot(groupId: groupId, keyVersion: version)
      do {
        let key: Data
        if let box = accountBox {
          key = try GroupKeys.open(envelope: text, groupId: groupId, keyVersion: version, recipientId: recipientId, signers: trustedSigners, knownAccounts: knownAccounts, recipient: box)
        } else if stored.hardware {
          key = try GroupKeys.open(
            envelope: text, groupId: groupId, keyVersion: version, recipientId: recipientId, signers: trustedSigners, knownAccounts: knownAccounts,
            recipient: try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: stored.box))
        } else {
          key = try GroupKeys.open(
            envelope: text, groupId: groupId, keyVersion: version, recipientId: recipientId, signers: trustedSigners, knownAccounts: knownAccounts,
            recipient: try P256.KeyAgreement.PrivateKey(rawRepresentation: stored.box))
        }
        // A held key is never replaced by a different one (docs/security.md section 10). The same key again is a no-op.
        if let held = keys[at], held != key { throw KeysError.badEnvelope }
        keys[at] = key
        opened.append(version)
      } catch {
        refused.append(version)
      }
    }
    if !opened.isEmpty {
      stored.groupKeys = keys
      try IdentityStore.save(stored, userId: userId)
    }
    return ["opened": opened, "refused": refused]
  }

  // Locks text under a held group key: the base64url of the locked bytes.
  static func lockContent(userId: String, groupId: String, keyVersion: Int, label: String, fields: [String], plaintext: String) throws -> String {
    let stored = try identity(userId)
    guard let version = UInt32(exactly: keyVersion) else { throw KeysError.badInput }
    let locked = try LockedContent.lock(
      key: try groupKey(stored, groupId: groupId, keyVersion: keyVersion), keyVersion: version, objectContext: try objectContext(label, groupId: groupId, fields: fields),
      plaintext: Data(plaintext.utf8))
    return Base64URL.encode(locked)
  }

  // Unlocks text; the key version comes from the header. UTF-8 text out.
  static func unlockContent(userId: String, groupId: String, label: String, fields: [String], locked: String) throws -> String {
    let stored = try identity(userId)
    let bytes = try Base64URL.decode(locked)
    let version = try LockedContent.keyVersion(bytes)
    let plain = try LockedContent.unlock(
      key: try groupKey(stored, groupId: groupId, keyVersion: Int(version)), objectContext: try objectContext(label, groupId: groupId, fields: fields), locked: bytes)
    guard let text = String(data: plain, encoding: .utf8) else { throw KeysError.badContent }
    return text
  }

  // Locks a file under Documents to another file, file to file, so the bytes never reach JavaScript. Returns the
  // number of bytes written.
  static func lockFile(userId: String, groupId: String, keyVersion: Int, blobId: String, inPath: String, outPath: String) throws -> Int {
    let stored = try identity(userId)
    guard let version = UInt32(exactly: keyVersion) else { throw KeysError.badInput }
    // The server refuses a blob over 95,000,000 bytes (MAX_BLOB_BYTES); locking adds 33 bytes (17 header, 16 tag).
    // Check the size before reading the file.
    let inURL = try documentsURL(inPath)
    guard (try FileManager.default.attributesOfItem(atPath: inURL.path)[.size] as? Int ?? Int.max) <= 95_000_000 - 33 else {
      throw KeysError.badInput
    }
    let plain = try Data(contentsOf: inURL)
    let locked = try LockedContent.lock(
      key: try groupKey(stored, groupId: groupId, keyVersion: keyVersion), keyVersion: version,
      objectContext: try context("blob", [try checkId(groupId), try checkId(blobId)]), plaintext: plain)
    try locked.write(to: try documentsURL(outPath), options: .atomic)
    return locked.count
  }

  // The reverse of lockFile.
  static func unlockFile(userId: String, groupId: String, blobId: String, inPath: String, outPath: String) throws {
    let stored = try identity(userId)
    let bytes = try Data(contentsOf: try documentsURL(inPath))
    let version = try LockedContent.keyVersion(bytes)
    let plain = try LockedContent.unlock(
      key: try groupKey(stored, groupId: groupId, keyVersion: Int(version)), objectContext: try context("blob", [try checkId(groupId), try checkId(blobId)]),
      locked: bytes)
    try plain.write(to: try documentsURL(outPath), options: .atomic)
  }

  // A shared link (docs/security.md section 11): a fresh random key, key version 0, nothing stored. The key goes
  // into the URL fragment; it is returned only for that.
  static func lockLink(linkId: String, plaintext: String) throws -> [String: String] {
    let key = randomBytes(32)
    let locked = try LockedContent.lock(
      key: SymmetricKey(data: key), keyVersion: 0, objectContext: try context("link", [try checkId(linkId)]), plaintext: Data(plaintext.utf8))
    return ["key": Base64URL.encode(key), "data": Base64URL.encode(locked)]
  }
}
