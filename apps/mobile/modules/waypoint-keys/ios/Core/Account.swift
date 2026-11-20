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

  // The certificate for this key's own row (self_cert in POST /v1/devices and DELETE /v1/devices/:id).
  public func selfCertificate(userId: String, accountId: String) throws -> String {
    try AccountCertificate.sign(sign, userId: userId, accountId: accountId, boxPub: boxPub)
  }

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
