import CryptoKit
import Foundation

// HPKE base mode, DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-256-GCM (docs/security.md section 3).
let suite = HPKE.Ciphersuite.P256_SHA256_AES_GCM_256

// A key wrapped for one device and signed by the device that wrapped it (docs/security.md section 9):
//   u8 version 1 | u8 purpose | enc (65) | u16 ct length | ct | u8 signer length | signer id | signature (64)
public enum Envelope {
  public enum Purpose: UInt8 {
    case groupKey = 1, accountKey = 2
    var keyBytes: Int { self == .groupKey ? 32 : 64 }
  }

  public struct Parsed: Equatable {
    public let purpose: Purpose
    public let enc: Data
    public let ct: Data
    public let signerId: String
    public let signature: Data
    public let body: Data // every byte before the signature
  }

  public static func groupKeyInfo(groupId: String, keyVersion: Int, deviceId: String) throws -> Data {
    guard keyVersion >= 1 else { throw KeysError.badInput }
    return try context("group-key", [try checkId(groupId), String(keyVersion), try checkId(deviceId)])
  }

  public static func accountKeyInfo(userId: String, accountDeviceId: String, deviceId: String) throws -> Data {
    try context("account-key", [try checkId(userId), try checkId(accountDeviceId), try checkId(deviceId)])
  }

  public static func signatureInput(info: Data, body: Data) throws -> Data {
    var out = try context("envelope-sig", [])
    out.append(try u16(info.count))
    out.append(info)
    out.append(body)
    return out
  }

  public static func parse(_ bytes: Data) throws -> Parsed {
    let b = [UInt8](bytes)
    guard b.count >= 2 + 65 + 2, b[0] == 1, let purpose = Purpose(rawValue: b[1]) else { throw KeysError.badEnvelope }
    var at = 2
    let enc = Data(b[at..<at + 65])
    at += 65
    let ctLength = Int(b[at]) << 8 | Int(b[at + 1])
    at += 2
    guard enc.first == 0x04, ctLength == purpose.keyBytes + 16, b.count > at + ctLength else { throw KeysError.badEnvelope }
    let ct = Data(b[at..<at + ctLength])
    at += ctLength
    let signerLength = Int(b[at])
    at += 1
    guard b.count == at + signerLength + 64, let signerId = String(bytes: b[at..<at + signerLength], encoding: .utf8),
      (try? checkId(signerId)) != nil
    else { throw KeysError.badEnvelope }
    at += signerLength
    return Parsed(purpose: purpose, enc: enc, ct: ct, signerId: signerId, signature: Data(b[at...]), body: Data(b[..<at]))
  }

  public static func make(purpose: Purpose, info: Data, recipientBoxPub: P256.KeyAgreement.PublicKey, key: Data, signerId: String, signer: some SigningKey) throws -> Data {
    guard key.count == purpose.keyBytes else { throw KeysError.badInput }
    let header = Data([1, purpose.rawValue])
    var sender = try HPKE.Sender(recipientKey: recipientBoxPub, ciphersuite: suite, info: info)
    let ct = try sender.seal(key, authenticating: header)
    let signer8 = Data(try checkId(signerId).utf8)
    var body = header
    body.append(sender.encapsulatedKey)
    body.append(try u16(ct.count))
    body.append(ct)
    body.append(UInt8(signer8.count))
    body.append(signer8)
    let signature = try signer.sign(try signatureInput(info: info, body: body))
    return body + signature
  }

  // The signature only; the caller also checks the signer's certificate (docs/security.md section 6).
  public static func verify(_ envelope: Parsed, info: Data, signerSignPub: P256.Signing.PublicKey) -> Bool {
    guard let message = try? signatureInput(info: info, body: envelope.body) else { return false }
    return verifyP256(signerSignPub, signature: envelope.signature, message: message)
  }

  // Works with a software key and with SecureEnclave.P256.KeyAgreement.PrivateKey.
  public static func open<K: HPKEDiffieHellmanPrivateKey>(_ envelope: Parsed, info: Data, recipient: K) throws -> Data {
    do {
      var r = try HPKE.Recipient(privateKey: recipient, ciphersuite: suite, info: info, encapsulatedKey: envelope.enc)
      return try r.open(envelope.ct, authenticating: Data([1, envelope.purpose.rawValue]))
    } catch {
      throw KeysError.badEnvelope
    }
  }
}

// A job result sealed to this device (docs/security.md section 14): u8 1 | u8 3 | enc (65) | ct.
public enum SealedResult {
  public static func info(jobId: String, deviceId: String) throws -> Data {
    try context("result", [try checkId(jobId), try checkId(deviceId)])
  }

  public static func open<K: HPKEDiffieHellmanPrivateKey>(_ sealed: Data, jobId: String, deviceId: String, recipient: K) throws -> Data {
    let b = [UInt8](sealed)
    guard b.count >= 2 + 65 + 16, b[0] == 1, b[1] == 3 else { throw KeysError.badSealed }
    do {
      var r = try HPKE.Recipient(privateKey: recipient, ciphersuite: suite, info: try info(jobId: jobId, deviceId: deviceId), encapsulatedKey: Data(b[2..<67]))
      return try r.open(Data(b[67...]), authenticating: Data([1, 3]))
    } catch {
      throw KeysError.badSealed
    }
  }
}
