import CryptoKit
import Foundation
import Testing
@testable import KeysCore

// Inputs each format must refuse, one check per test (M26a review: these checks had no test).
private let v = try! readVectors("waypoint-v1.json", as: WaypointV1.self)

private func b64(_ text: String) -> Data { try! Base64URL.decode(text) }

@Test func envelopeParseRefusesACiphertextLengthForTheOtherPurpose() {
  var bytes = b64(v.group_key_envelope.envelope)
  bytes[1] = 2 // account key: its ciphertext is 80 bytes, this one is 48
  #expect(throws: KeysError.badEnvelope) { try Envelope.parse(bytes) }
}

@Test func envelopeParseRefusesAnEncThatIsNotAnUncompressedPoint() {
  var bytes = b64(v.group_key_envelope.envelope)
  bytes[2] = 0x02
  #expect(throws: KeysError.badEnvelope) { try Envelope.parse(bytes) }
}

@Test func envelopeParseRefusesASignerIdThatIsNotAnId() {
  var bytes = b64(v.group_key_envelope.envelope)
  bytes[2 + 65 + 2 + 48 + 1] = 0x20 // first character of the signer id becomes a space
  #expect(throws: KeysError.badEnvelope) { try Envelope.parse(bytes) }
}

@Test func sealedResultRefusesAnotherPurposeByte() {
  let s = v.sealed_result
  var bytes = b64(s.sealed)
  bytes[1] = 1
  let key = try! P256.KeyAgreement.PrivateKey(rawRepresentation: Data(hex: s.device_private_key))
  #expect(throws: KeysError.badSealed) { try SealedResult.open(bytes, jobId: s.job_id, deviceId: s.device_id, recipient: key) }
}

@Test func pairingRefusesANonceThatIsNot32Bytes() {
  let p = v.pairing
  let short = Base64URL.encode(Data(repeating: 7, count: 16))
  #expect(throws: KeysError.badNonce) { try Pairing.commitment(signPub: p.new_sign_pub, boxPub: p.new_box_pub, newNonce: short) }
  #expect(throws: KeysError.badNonce) {
    try Pairing.code(newSignPub: p.new_sign_pub, newBoxPub: p.new_box_pub, approverSignPub: p.approver_sign_pub, approverNonce: short, newNonce: p.new_nonce)
  }
}

@Test func recoveryUnwrapRefusesAnotherVersionByte() throws {
  let r = v.recovery
  let wrapKey = try Recovery.wrapKey(entropy: Data(hex: r.entropy), userId: r.user_id)
  var blob = b64(r.blob)
  blob[0] = 2
  #expect(throws: KeysError.badRecovery) { try Recovery.unwrap(blob, wrapKey: wrapKey, userId: r.user_id, accountDeviceId: r.account_device_id) }
}

@Test func recoveryWrapRefusesAWrongKeyOrNonceLength() throws {
  let r = v.recovery
  let wrapKey = try Recovery.wrapKey(entropy: Data(hex: r.entropy), userId: r.user_id)
  #expect(throws: KeysError.badRecovery) {
    try Recovery.wrap(accountKey: Data(repeating: 1, count: 32), wrapKey: wrapKey, userId: r.user_id, accountDeviceId: r.account_device_id)
  }
  #expect(throws: KeysError.badRecovery) {
    try Recovery.wrap(accountKey: Data(hex: r.account_key), wrapKey: wrapKey, userId: r.user_id, accountDeviceId: r.account_device_id, nonce: Data(repeating: 1, count: 11))
  }
}

@Test func lockedContentWritesAllFourKeyVersionBytes() throws {
  let key = SymmetricKey(data: Data(repeating: 9, count: 32))
  let locked = try LockedContent.lock(key: key, keyVersion: 0xffff_fff1, objectContext: Data([1]), plaintext: Data([2]), nonce: Data(repeating: 3, count: 12))
  #expect([UInt8](locked.prefix(5)) == [1, 0xff, 0xff, 0xff, 0xf1])
  #expect(try LockedContent.keyVersion(locked) == 0xffff_fff1)
  #expect(try LockedContent.unlock(key: key, objectContext: Data([1]), locked: locked) == Data([2]))
}

@Test func publicKeyRawRefusesACompressedPrefix() {
  let compressed = Base64URL.encode(Data([2] + Array(repeating: 1, count: 64)))
  #expect(throws: KeysError.badPublicKey) { try PublicKeys.raw(compressed) }
}
