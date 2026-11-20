import CryptoKit
import Foundation
import Testing
@testable import KeysCore

private struct Member {
  let userId: String
  let account = P256.Signing.PrivateKey()
  let deviceSign = P256.Signing.PrivateKey()
  let deviceBox = P256.KeyAgreement.PrivateKey()
  let deviceId: String
  var signer: GroupKeys.Signer {
    let cert = try! DeviceCertificate.sign(account, userId: userId, deviceId: deviceId, signPub: deviceSign.publicKeyText, boxPub: boxKeyText(deviceBox.publicKey))
    return GroupKeys.Signer(id: deviceId, userId: userId, signPub: deviceSign.publicKeyText, boxPub: boxKeyText(deviceBox.publicKey), cert: cert)
  }
}

@Test func groupKeyWrapsAndOpensOnlyFromATrustedSigner() throws {
  let sam = Member(userId: "usr_sam", deviceId: "dev_sam")
  let ana = Member(userId: "usr_ana", deviceId: "dev_ana")
  let key = GroupKeys.newKey()
  let wrapped = try GroupKeys.wrap(key: key, groupId: "grp_0123456789abcdef", keyVersion: 2, recipientId: ana.deviceId, recipientBoxPub: boxKeyText(ana.deviceBox.publicKey), signerId: sam.deviceId, signer: sam.deviceSign)
  let known = [sam.userId: sam.account.publicKeyText]
  let signers = [sam.deviceId: sam.signer]
  #expect(try GroupKeys.open(envelope: wrapped, groupId: "grp_0123456789abcdef", keyVersion: 2, recipientId: ana.deviceId, signers: signers, knownAccounts: known, recipient: ana.deviceBox) == key)
  // Sam's account key unknown, or changed: refused before anything is opened.
  #expect(throws: KeysError.badEnvelope) {
    try GroupKeys.open(envelope: wrapped, groupId: "grp_0123456789abcdef", keyVersion: 2, recipientId: ana.deviceId, signers: signers, knownAccounts: [:], recipient: ana.deviceBox)
  }
  #expect(throws: KeysError.badEnvelope) {
    try GroupKeys.open(envelope: wrapped, groupId: "grp_0123456789abcdef", keyVersion: 2, recipientId: ana.deviceId, signers: signers, knownAccounts: [sam.userId: P256.Signing.PrivateKey().publicKeyText], recipient: ana.deviceBox)
  }
  // Another version or group does not open.
  #expect(throws: KeysError.self) {
    try GroupKeys.open(envelope: wrapped, groupId: "grp_0123456789abcdef", keyVersion: 3, recipientId: ana.deviceId, signers: signers, knownAccounts: known, recipient: ana.deviceBox)
  }
  // A signer listed under another person's account (the server lying about who it belongs to) is refused.
  let liar = GroupKeys.Signer(id: sam.deviceId, userId: ana.userId, signPub: sam.signer.signPub, boxPub: sam.signer.boxPub, cert: sam.signer.cert)
  #expect(throws: KeysError.badEnvelope) {
    try GroupKeys.open(envelope: wrapped, groupId: "grp_0123456789abcdef", keyVersion: 2, recipientId: ana.deviceId, signers: [sam.deviceId: liar], knownAccounts: [ana.userId: ana.account.publicKeyText], recipient: ana.deviceBox)
  }
}

@Test func lockedContentWithAGroupKeyRoundTrips() throws {
  let key = SymmetricKey(data: GroupKeys.newKey())
  let ctx = try context("change", ["grp_0123456789abcdef", "dev_sam", "session"])
  let locked = try LockedContent.lock(key: key, keyVersion: 4, objectContext: ctx, plaintext: Data("{}".utf8))
  #expect(try LockedContent.keyVersion(locked) == 4)
  #expect(try LockedContent.unlock(key: key, objectContext: ctx, locked: locked) == Data("{}".utf8))
  #expect(throws: KeysError.badContent) { try LockedContent.unlock(key: key, objectContext: try context("change", ["grp_0123456789abcdef", "dev_ana", "session"]), locked: locked) }
}
