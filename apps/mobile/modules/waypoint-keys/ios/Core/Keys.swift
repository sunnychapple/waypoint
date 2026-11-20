import CryptoKit
import Foundation

// Public keys travel as base64url of the 65-byte SEC1 point 04 ‖ X ‖ Y (x963Representation); signatures as the
// 64-byte r ‖ s (rawRepresentation).
public enum PublicKeys {
  // Length and prefix only, like the server's decodePublicKey (used inside contexts).
  public static func raw(_ text: String) throws -> Data {
    let bytes = try Base64URL.decode(text)
    guard bytes.count == 65, bytes.first == 0x04 else { throw KeysError.badPublicKey }
    return bytes
  }

  // Also checks the point is on the curve.
  public static func signing(_ text: String) throws -> P256.Signing.PublicKey {
    do { return try P256.Signing.PublicKey(x963Representation: try raw(text)) } catch { throw KeysError.badPublicKey }
  }

  public static func box(_ text: String) throws -> P256.KeyAgreement.PublicKey {
    do { return try P256.KeyAgreement.PublicKey(x963Representation: try raw(text)) } catch { throw KeysError.badPublicKey }
  }
}

// A P-256 signing key: the Secure Enclave key on the phone, a software key in tests and for the account key.
public protocol SigningKey {
  var publicKeyText: String { get }
  func sign(_ message: Data) throws -> Data // 64 bytes, r ‖ s
}

extension P256.Signing.PrivateKey: SigningKey {
  public var publicKeyText: String { Base64URL.encode(publicKey.x963Representation) }
  public func sign(_ message: Data) throws -> Data { try signature(for: message).rawRepresentation }
}

extension SecureEnclave.P256.Signing.PrivateKey: SigningKey {
  public var publicKeyText: String { Base64URL.encode(publicKey.x963Representation) }
  public func sign(_ message: Data) throws -> Data { try signature(for: message).rawRepresentation }
}

public func boxKeyText(_ key: P256.KeyAgreement.PublicKey) -> String { Base64URL.encode(key.x963Representation) }

// ECDSA P-256 / SHA-256 over message; false for any malformed input.
public func verifyP256(_ publicKey: P256.Signing.PublicKey, signature: Data, message: Data) -> Bool {
  guard signature.count == 64, let sig = try? P256.Signing.ECDSASignature(rawRepresentation: signature) else { return false }
  return publicKey.isValidSignature(sig, for: message)
}
