import CryptoKit
import Foundation

// Every way a Waypoint format can be refused. JavaScript sees the case name as error.code (see WaypointKeysModule).
public enum KeysError: Error, Equatable {
  case badBase64URL, badHex, badLabel, badId, badPublicKey, badSignature, badNonce, badInput
  case badEnvelope, badSealed, badRecovery, badContent, badCommitment
}

// Base64url without padding (docs/security.md section 4). Decoding is strict: no padding, no "+/", and the text
// must be the canonical encoding of its bytes.
public enum Base64URL {
  public static func encode(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  public static func decode(_ text: String) throws -> Data {
    let ok = text.utf8.allSatisfy { c in
      (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x2d || c == 0x5f
    }
    guard ok, text.utf8.count % 4 != 1 else { throw KeysError.badBase64URL }
    var b64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    b64 += String(repeating: "=", count: (4 - b64.utf8.count % 4) % 4)
    guard let data = Data(base64Encoded: b64), encode(data) == text else { throw KeysError.badBase64URL }
    return data
  }
}

extension Data {
  public var hex: String { map { String(format: "%02x", $0) }.joined() }

  // Lowercase hex only, as in the test vectors.
  public init(hex text: String) throws {
    guard text.utf8.count % 2 == 0, text.utf8.allSatisfy({ ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x66) }) else {
      throw KeysError.badHex
    }
    var out = Data(capacity: text.utf8.count / 2)
    var index = text.startIndex
    while index < text.endIndex {
      let next = text.index(index, offsetBy: 2)
      out.append(UInt8(text[index..<next], radix: 16)!)
      index = next
    }
    self = out
  }
}

func u16(_ value: Int) throws -> Data {
  guard value >= 0, value <= 0xffff else { throw KeysError.badInput }
  return Data([UInt8(value >> 8), UInt8(value & 0xff)])
}

func sha256(_ data: Data) -> Data { Data(SHA256.hash(data: data)) }

// Random bytes from the system generator (CryptoKit's SymmetricKey uses it).
public func randomBytes(_ count: Int) -> Data {
  SymmetricKey(size: SymmetricKeySize(bitCount: count * 8)).withUnsafeBytes { Data($0) }
}

// Ids inside signed or encrypted context: ^[A-Za-z0-9_-]{1,64}$.
@discardableResult
public func checkId(_ id: String) throws -> String {
  let ok = (1...64).contains(id.utf8.count) && id.utf8.allSatisfy { c in
    (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x2d || c == 0x5f
  }
  guard ok else { throw KeysError.badId }
  return id
}

// context(label, f1, f2, ...) = "waypoint/v1/" ‖ label ‖ 0x00 ‖ u16(len f1) ‖ f1 ‖ ... (docs/security.md section 4).
public func context(_ label: String, _ fields: [String]) throws -> Data {
  let labelOk = (1...32).contains(label.utf8.count) && label.utf8.allSatisfy { c in
    (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x2d
  }
  guard labelOk else { throw KeysError.badLabel }
  var out = Data("waypoint/v1/\(label)".utf8)
  out.append(0)
  for field in fields {
    let bytes = Data(field.utf8)
    out.append(try u16(bytes.count))
    out.append(bytes)
  }
  return out
}
