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
