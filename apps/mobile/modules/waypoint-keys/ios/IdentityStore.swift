import CryptoKit
import Foundation
import Security

// This device's keys for one Waypoint user, kept as one Keychain item (docs/security.md sections 5 and 19).
// The Secure Enclave keys are stored as their dataRepresentation, which only this phone's Secure Enclave can use.
struct StoredIdentity: Codable {
  var deviceId: String
  var hardware: Bool // true: Secure Enclave keys; false: software keys (Simulator only)
  var sign: Data
  var box: Data
  var accountId: String?
  var accountKey: Data? // 64 bytes: account signing scalar, then account encryption scalar
  var pairingNonce: String? // base64url, 32 bytes; kept until the pairing ends (M27b)
  var pendingAccountId: String? // a new account key made for a device removal, until the server accepts it (M27b)
  var pendingAccountKey: Data?
  var groupKeys: [String: Data]? // "<group id>/<key version>" → 32 bytes (M28a)
}

enum IdentityStore {
  static let service = "app.waypoint.keys"

  static func load(userId: String) throws -> StoredIdentity? {
    var query = baseQuery(userId)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = item as? Data else { throw keychainError(status) }
    return try JSONDecoder().decode(StoredIdentity.self, from: data)
  }

  static func save(_ identity: StoredIdentity, userId: String) throws {
    let data = try JSONEncoder().encode(identity)
    let update = SecItemUpdate(baseQuery(userId) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if update == errSecSuccess { return }
    guard update == errSecItemNotFound else { throw keychainError(update) }
    var add = baseQuery(userId)
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(add as CFDictionary, nil)
    guard status == errSecSuccess else { throw keychainError(status) }
  }

  static func delete(userId: String) throws {
    let status = SecItemDelete(baseQuery(userId) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw keychainError(status) }
  }

  // Makes the two device keys. Secure Enclave on a phone; software keys only in the Simulator.
  static func makeIdentity(deviceId: String) throws -> StoredIdentity {
    if SecureEnclave.isAvailable {
      var error: Unmanaged<CFError>?
      guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, .privateKeyUsage, &error) else {
        throw KeysModuleError.noSecureEnclave
      }
      let sign = try SecureEnclave.P256.Signing.PrivateKey(accessControl: access)
      let box = try SecureEnclave.P256.KeyAgreement.PrivateKey(accessControl: access)
      return StoredIdentity(deviceId: deviceId, hardware: true, sign: sign.dataRepresentation, box: box.dataRepresentation)
    }
    #if targetEnvironment(simulator)
    return StoredIdentity(deviceId: deviceId, hardware: false, sign: P256.Signing.PrivateKey().rawRepresentation, box: P256.KeyAgreement.PrivateKey().rawRepresentation)
    #else
    throw KeysModuleError.noSecureEnclave
    #endif
  }

  static func signingKey(_ identity: StoredIdentity) throws -> any SigningKey {
    identity.hardware
      ? try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: identity.sign)
      : try P256.Signing.PrivateKey(rawRepresentation: identity.sign)
  }

  static func signPub(_ identity: StoredIdentity) throws -> String { try signingKey(identity).publicKeyText }

  static func boxPub(_ identity: StoredIdentity) throws -> String {
    identity.hardware
      ? boxKeyText(try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: identity.box).publicKey)
      : boxKeyText(try P256.KeyAgreement.PrivateKey(rawRepresentation: identity.box).publicKey)
  }

  static func openSealed(_ identity: StoredIdentity, sealed: Data, jobId: String) throws -> Data {
    identity.hardware
      ? try SealedResult.open(sealed, jobId: jobId, deviceId: identity.deviceId, recipient: try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: identity.box))
      : try SealedResult.open(sealed, jobId: jobId, deviceId: identity.deviceId, recipient: try P256.KeyAgreement.PrivateKey(rawRepresentation: identity.box))
  }

  private static func baseQuery(_ userId: String) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: userId]
  }

  private static func keychainError(_ status: OSStatus) -> KeysModuleError { .keychain(Int(status)) }
}

enum KeysModuleError: Error {
  case noSecureEnclave, noIdentity, exists, keychain(Int), noAccountKey, noPairing, noGroupKey

  var code: String {
    switch self {
    case .noSecureEnclave: return "no_secure_enclave"
    case .noIdentity: return "no_identity"
    case .noAccountKey: return "no_account_key"
    case .noPairing: return "no_pairing"
    case .noGroupKey: return "no_group_key"
    case .exists: return "exists"
    case .keychain: return "keychain"
    }
  }

  // The code, plus the OSStatus for Keychain errors (a status number is not secret).
  var message: String {
    if case .keychain(let status) = self { return "keychain \(status)" }
    return code
  }
}

// What the module's functions do, without ExpoModulesCore. Public keys and signatures are base64url text.
enum KeysOps {
  // One process-wide lock: every load-modify-save of a user's Keychain item runs inside it.
  static let lock = NSLock()

  static func keysView(_ identity: StoredIdentity) throws -> [String: Any] {
    ["deviceId": identity.deviceId, "signPub": try IdentityStore.signPub(identity), "boxPub": try IdentityStore.boxPub(identity), "hardware": identity.hardware]
  }

  static func getDeviceKeys(userId: String) throws -> [String: Any]? {
    guard let identity = try IdentityStore.load(userId: try checkId(userId)) else { return nil }
    return try keysView(identity)
  }

  // Returns the keys already made for this user, or makes them with deviceId.
  static func ensureDeviceKeys(userId: String, deviceId: String) throws -> [String: Any] {
    lock.lock(); defer { lock.unlock() }
    if let identity = try IdentityStore.load(userId: try checkId(userId)) { return try keysView(identity) }
    let identity = try IdentityStore.makeIdentity(deviceId: try checkId(deviceId))
    try IdentityStore.save(identity, userId: userId)
    return try keysView(identity)
  }

  // Forgets this user's keys (the device was removed, or must register again under a new id).
  static func deleteDeviceKeys(userId: String) throws {
    lock.lock(); defer { lock.unlock() }
    try IdentityStore.delete(userId: try checkId(userId))
  }

  // First device only: makes the account key (software P-256, docs/security.md section 5), keeps it with the
  // device keys, certifies this device and the account row itself (selfCert). Returns the existing account key when
  // there is one.
  static func ensureAccountKey(userId: String, accountId: String) throws -> [String: Any] {
    lock.lock(); defer { lock.unlock() }
    guard var identity = try IdentityStore.load(userId: try checkId(userId)) else { throw KeysModuleError.noIdentity }
    if identity.accountId == nil || identity.accountKey == nil {
      let sign = P256.Signing.PrivateKey()
      let box = P256.KeyAgreement.PrivateKey()
      identity.accountId = try checkId(accountId)
      identity.accountKey = sign.rawRepresentation + box.rawRepresentation
      try IdentityStore.save(identity, userId: userId)
    }
    guard let id = identity.accountId, let key = identity.accountKey, key.count == 64 else { throw KeysModuleError.noIdentity }
    let sign = try P256.Signing.PrivateKey(rawRepresentation: key.prefix(32))
    let box = try P256.KeyAgreement.PrivateKey(rawRepresentation: key.suffix(32))
    let cert = try DeviceCertificate.sign(sign, userId: userId, deviceId: identity.deviceId, signPub: try IdentityStore.signPub(identity), boxPub: try IdentityStore.boxPub(identity))
    let selfCert = try AccountCertificate.sign(sign, userId: userId, accountId: id, boxPub: boxKeyText(box.publicKey))
    return ["accountId": id, "signPub": sign.publicKeyText, "boxPub": boxKeyText(box.publicKey), "cert": cert, "selfCert": selfCert]
  }

  // Another device already holds the account key: drop ours (a lost race to be the first device).
  static func deleteAccountKey(userId: String) throws {
    lock.lock(); defer { lock.unlock() }
    guard var identity = try IdentityStore.load(userId: try checkId(userId)) else { return }
    identity.accountId = nil
    identity.accountKey = nil
    try IdentityStore.save(identity, userId: userId)
  }

  // A new device's pairing commitment (docs/security.md section 8). The nonce stays in the Keychain, unrevealed.
  static func startPairing(userId: String) throws -> String {
    lock.lock(); defer { lock.unlock() }
    guard var identity = try IdentityStore.load(userId: try checkId(userId)) else { throw KeysModuleError.noIdentity }
    let nonce = identity.pairingNonce ?? Pairing.newNonce()
    identity.pairingNonce = nonce
    try IdentityStore.save(identity, userId: userId)
    return try Pairing.commitment(signPub: try IdentityStore.signPub(identity), boxPub: try IdentityStore.boxPub(identity), newNonce: nonce)
  }

  static func signRequest(userId: String, method: String, target: String, deviceId: String, timestamp: Double, body: String) throws -> [String: Any] {
    guard let identity = try IdentityStore.load(userId: try checkId(userId)) else { throw KeysModuleError.noIdentity }
    guard deviceId == identity.deviceId || deviceId == RequestSigning.newDevice else { throw KeysError.badInput }
    // Int64(exactly:) is nil for NaN, infinity and non-integers; Int64(timestamp) would trap on them.
    guard let ts = Int64(exactly: timestamp), ts >= 0, ts <= 9_007_199_254_740_991 else { throw KeysError.badInput }
    let signed = try RequestSigning.sign(try IdentityStore.signingKey(identity), method: method, target: target, deviceId: deviceId, timestamp: ts, body: Data(body.utf8))
    return ["nonce": signed.nonce, "signature": signed.signature]
  }

  // A job result sealed to this device (docs/security.md section 14); returns its UTF-8 text.
  static func openSealedResult(userId: String, jobId: String, sealed: String) throws -> String {
    guard let identity = try IdentityStore.load(userId: try checkId(userId)) else { throw KeysModuleError.noIdentity }
    let plain = try IdentityStore.openSealed(identity, sealed: try Base64URL.decode(sealed), jobId: jobId)
    guard let text = String(data: plain, encoding: .utf8) else { throw KeysError.badSealed }
    return text
  }
}
