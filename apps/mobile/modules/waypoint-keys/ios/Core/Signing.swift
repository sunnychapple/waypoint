import CryptoKit
import Foundation

// Request signatures (docs/security.md section 7).
public enum RequestSigning {
  public static let newDevice = "new" // Waypoint-Device while registering (POST /v1/devices)

  public static func bodySha256Hex(_ body: Data) -> String { sha256(body).hex }

  public static func input(method: String, target: String, deviceId: String, timestamp: Int64, nonce: String, bodySha256Hex: String) throws -> Data {
    let methodOk = (3...7).contains(method.utf8.count) && method.utf8.allSatisfy { $0 >= 0x41 && $0 <= 0x5a }
    let targetOk = target.first == "/" && target.utf8.count <= 2048 && target.utf8.allSatisfy { $0 >= 0x21 && $0 <= 0x7e }
    let hashOk = bodySha256Hex.utf8.count == 64 && bodySha256Hex.utf8.allSatisfy { ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x66) }
    guard methodOk, targetOk, hashOk, timestamp >= 0 else { throw KeysError.badInput }
    if deviceId != newDevice { try checkId(deviceId) }
    guard nonce.utf8.count == 22, (try? Base64URL.decode(nonce))?.count == 16 else { throw KeysError.badNonce }
    return try context("request", [method, target, deviceId, String(timestamp), nonce, bodySha256Hex])
  }

  // A new 16-byte nonce on every call, including retries of the same request.
  public static func sign(_ key: some SigningKey, method: String, target: String, deviceId: String, timestamp: Int64, body: Data) throws -> (nonce: String, signature: String) {
    let nonce = Base64URL.encode(randomBytes(16))
    let message = try input(method: method, target: target, deviceId: deviceId, timestamp: timestamp, nonce: nonce, bodySha256Hex: bodySha256Hex(body))
    return (nonce, Base64URL.encode(try key.sign(message)))
  }
}

// Adding a device (docs/security.md section 8). Keys and nonces are base64url text.
public enum Pairing {
  public static func newNonce() -> String { Base64URL.encode(randomBytes(32)) }

  static func checkNonce(_ nonce: String) throws -> String {
    guard (try? Base64URL.decode(nonce))?.count == 32 else { throw KeysError.badNonce }
    return nonce
  }

  public static func commitment(signPub: String, boxPub: String, newNonce: String) throws -> String {
    _ = try PublicKeys.raw(signPub)
    _ = try PublicKeys.raw(boxPub)
    return Base64URL.encode(sha256(try context("pair-commit", [signPub, boxPub, try checkNonce(newNonce)])))
  }

  // First 4 bytes of the hash, big-endian, mod 1,000,000, as 6 digits.
  public static func code(newSignPub: String, newBoxPub: String, approverSignPub: String, approverNonce: String, newNonce: String) throws -> String {
    for key in [newSignPub, newBoxPub, approverSignPub] { _ = try PublicKeys.raw(key) }
    let digest = sha256(try context("pair-code", [newSignPub, newBoxPub, approverSignPub, try checkNonce(approverNonce), try checkNonce(newNonce)]))
    let value = digest.prefix(4).reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    let code = String(value % 1_000_000)
    return String(repeating: "0", count: 6 - code.count) + code
  }
}

// The account key's signature over a device's keys (docs/security.md section 6).
public enum DeviceCertificate {
  public static func input(userId: String, deviceId: String, signPub: String, boxPub: String) throws -> Data {
    _ = try PublicKeys.raw(signPub)
    _ = try PublicKeys.raw(boxPub)
    return try context("device-cert", [try checkId(userId), try checkId(deviceId), signPub, boxPub])
  }

  public static func sign(_ accountKey: some SigningKey, userId: String, deviceId: String, signPub: String, boxPub: String) throws -> String {
    Base64URL.encode(try accountKey.sign(try input(userId: userId, deviceId: deviceId, signPub: signPub, boxPub: boxPub)))
  }

  public static func verify(accountSignPub: String, cert: String, userId: String, deviceId: String, signPub: String, boxPub: String) -> Bool {
    guard let key = try? PublicKeys.signing(accountSignPub), let sig = try? Base64URL.decode(cert),
      let message = try? input(userId: userId, deviceId: deviceId, signPub: signPub, boxPub: boxPub)
    else { return false }
    return verifyP256(key, signature: sig, message: message)
  }
}

// The account key's signature over its own row (docs/security.md section 6, "Account certificate"). Without it, a
// server could list a person's known account sign_pub next to a box_pub of its own and receive group keys.
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
