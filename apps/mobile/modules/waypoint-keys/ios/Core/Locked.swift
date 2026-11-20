import CryptoKit
import Foundation

// The recovery blob (docs/security.md section 13): u8 1 | nonce (12) | AES-256-GCM(account key, 64 B) ‖ tag (16) = 93 bytes.
public enum Recovery {
  public static func wrapKey(entropy: Data, userId: String) throws -> SymmetricKey {
    guard entropy.count == 16 else { throw KeysError.badRecovery }
    return HKDF<SHA256>.deriveKey(
      inputKeyMaterial: SymmetricKey(data: entropy), salt: Data(), info: try context("recovery-key", [try checkId(userId)]), outputByteCount: 32)
  }

  public static func aad(userId: String, accountDeviceId: String) throws -> Data {
    Data([1]) + (try context("recovery", [try checkId(userId), try checkId(accountDeviceId)]))
  }

  public static func wrap(accountKey: Data, wrapKey: SymmetricKey, userId: String, accountDeviceId: String, nonce: Data = randomBytes(12)) throws -> Data {
    guard accountKey.count == 64, nonce.count == 12 else { throw KeysError.badRecovery }
    let box = try AES.GCM.seal(accountKey, using: wrapKey, nonce: try AES.GCM.Nonce(data: nonce), authenticating: try aad(userId: userId, accountDeviceId: accountDeviceId))
    return Data([1]) + nonce + box.ciphertext + box.tag
  }

  public static func unwrap(_ blob: Data, wrapKey: SymmetricKey, userId: String, accountDeviceId: String) throws -> Data {
    let b = [UInt8](blob)
    guard b.count == 93, b[0] == 1 else { throw KeysError.badRecovery }
    do {
      let box = try AES.GCM.SealedBox(nonce: try AES.GCM.Nonce(data: Data(b[1..<13])), ciphertext: Data(b[13..<77]), tag: Data(b[77...]))
      return try AES.GCM.open(box, using: wrapKey, authenticating: try aad(userId: userId, accountDeviceId: accountDeviceId))
    } catch {
      throw KeysError.badRecovery
    }
  }
}

// Locked content (docs/security.md section 11): u8 1 | u32 key version | nonce (12) | ciphertext ‖ tag;
// AAD = the 17 header bytes ‖ the object's context.
public enum LockedContent {
  static func header(keyVersion: UInt32, nonce: Data) -> Data {
    Data([1, UInt8(keyVersion >> 24), UInt8(keyVersion >> 16 & 0xff), UInt8(keyVersion >> 8 & 0xff), UInt8(keyVersion & 0xff)]) + nonce
  }

  public static func lock(key: SymmetricKey, keyVersion: UInt32, objectContext: Data, plaintext: Data, nonce: Data = randomBytes(12)) throws -> Data {
    guard key.bitCount == 256, nonce.count == 12 else { throw KeysError.badContent }
    let head = header(keyVersion: keyVersion, nonce: nonce)
    let box = try AES.GCM.seal(plaintext, using: key, nonce: try AES.GCM.Nonce(data: nonce), authenticating: head + objectContext)
    return head + box.ciphertext + box.tag
  }

  public static func keyVersion(_ locked: Data) throws -> UInt32 {
    let b = [UInt8](locked)
    guard b.count >= 17 + 16, b[0] == 1 else { throw KeysError.badContent }
    return b[1...4].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
  }

  public static func unlock(key: SymmetricKey, objectContext: Data, locked: Data) throws -> Data {
    _ = try keyVersion(locked)
    let b = [UInt8](locked)
    do {
      let box = try AES.GCM.SealedBox(nonce: try AES.GCM.Nonce(data: Data(b[5..<17])), ciphertext: Data(b[17..<(b.count - 16)]), tag: Data(b[(b.count - 16)...]))
      return try AES.GCM.open(box, using: key, authenticating: Data(b[0..<17]) + objectContext)
    } catch {
      throw KeysError.badContent
    }
  }
}
