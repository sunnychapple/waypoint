import CryptoKit
import Foundation
import Testing
@testable import KeysCore

private let v = try! readVectors("waypoint-v1.json", as: WaypointV1.self)

private func b64(_ text: String) -> Data { try! Base64URL.decode(text) }
private func boxKey(_ hex: String) -> P256.KeyAgreement.PrivateKey { try! P256.KeyAgreement.PrivateKey(rawRepresentation: Data(hex: hex)) }
private func signKey(_ hex: String) -> P256.Signing.PrivateKey { try! P256.Signing.PrivateKey(rawRepresentation: Data(hex: hex)) }

@Test func contextMatchesTheVector() throws {
  #expect(try context(v.context.label, v.context.fields).hex == v.context.bytes)
}

@Test func requestSigningInputAndSignature() throws {
  let r = v.request
  #expect(RequestSigning.bodySha256Hex(Data(r.body_utf8.utf8)) == r.bodySha256)
  let input = try RequestSigning.input(method: r.method, target: r.target, deviceId: r.deviceId, timestamp: r.timestamp, nonce: r.nonce, bodySha256Hex: r.bodySha256)
  #expect(input.hex == r.signing_input)
  let pub = try PublicKeys.signing(r.device_sign_pub)
  #expect(verifyP256(pub, signature: b64(r.signature), message: input))
  let later = try RequestSigning.input(method: r.method, target: r.target, deviceId: r.deviceId, timestamp: r.timestamp + 1, nonce: r.nonce, bodySha256Hex: r.bodySha256)
  #expect(!verifyP256(pub, signature: b64(r.signature), message: later))
  // The vector's private key is the key whose public half is device_sign_pub; our own signature verifies too.
  let key = signKey(r.device_private_key)
  #expect(key.publicKeyText == r.device_sign_pub)
  let signed = try RequestSigning.sign(key, method: r.method, target: r.target, deviceId: r.deviceId, timestamp: r.timestamp, body: Data(r.body_utf8.utf8))
  let again = try RequestSigning.sign(key, method: r.method, target: r.target, deviceId: r.deviceId, timestamp: r.timestamp, body: Data(r.body_utf8.utf8))
  #expect(signed.nonce != again.nonce)
  let ours = try RequestSigning.input(method: r.method, target: r.target, deviceId: r.deviceId, timestamp: r.timestamp, nonce: signed.nonce, bodySha256Hex: r.bodySha256)
  #expect(verifyP256(pub, signature: b64(signed.signature), message: ours))
}

@Test func requestSigningInputRefusesBadFields() {
  let r = v.request
  let bad: [(String, String, String, Int64, String, String)] = [
    ("post", r.target, r.deviceId, r.timestamp, r.nonce, r.bodySha256),
    (r.method, "v1/x", r.deviceId, r.timestamp, r.nonce, r.bodySha256),
    (r.method, "/v1/a b", r.deviceId, r.timestamp, r.nonce, r.bodySha256),
    (r.method, r.target, "dev phone", r.timestamp, r.nonce, r.bodySha256),
    (r.method, r.target, r.deviceId, -1, r.nonce, r.bodySha256),
    (r.method, r.target, r.deviceId, r.timestamp, "AQID", r.bodySha256),
    (r.method, r.target, r.deviceId, r.timestamp, r.nonce, String(r.bodySha256.dropLast())),
  ]
  for b in bad {
    #expect(throws: KeysError.self) { try RequestSigning.input(method: b.0, target: b.1, deviceId: b.2, timestamp: b.3, nonce: b.4, bodySha256Hex: b.5) }
  }
  #expect(throws: Never.self) { try RequestSigning.input(method: "POST", target: "/v1/devices", deviceId: "new", timestamp: 0, nonce: r.nonce, bodySha256Hex: r.bodySha256) }
}

@Test func pairingCommitmentAndCode() throws {
  let p = v.pairing
  #expect(try Pairing.commitment(signPub: p.new_sign_pub, boxPub: p.new_box_pub, newNonce: p.new_nonce) == p.commitment)
  #expect(try Pairing.code(newSignPub: p.new_sign_pub, newBoxPub: p.new_box_pub, approverSignPub: p.approver_sign_pub, approverNonce: p.approver_nonce, newNonce: p.new_nonce) == p.code)
  #expect(try Pairing.code(newSignPub: p.new_sign_pub, newBoxPub: p.new_box_pub, approverSignPub: p.approver_sign_pub, approverNonce: p.new_nonce, newNonce: p.approver_nonce) != p.code)
  #expect(b64(Pairing.newNonce()).count == 32)
}

@Test func deviceCertificate() throws {
  let c = v.device_certificate
  #expect(try DeviceCertificate.input(userId: c.user_id, deviceId: c.device_id, signPub: c.sign_pub, boxPub: c.box_pub).hex == c.signing_input)
  #expect(DeviceCertificate.verify(accountSignPub: c.account_sign_pub, cert: c.signature, userId: c.user_id, deviceId: c.device_id, signPub: c.sign_pub, boxPub: c.box_pub))
  #expect(!DeviceCertificate.verify(accountSignPub: c.account_sign_pub, cert: c.signature, userId: "usr_2", deviceId: c.device_id, signPub: c.sign_pub, boxPub: c.box_pub))
  let account = signKey(c.account_private_key)
  #expect(account.publicKeyText == c.account_sign_pub)
  let cert = try DeviceCertificate.sign(account, userId: c.user_id, deviceId: c.device_id, signPub: c.sign_pub, boxPub: c.box_pub)
  #expect(DeviceCertificate.verify(accountSignPub: c.account_sign_pub, cert: cert, userId: c.user_id, deviceId: c.device_id, signPub: c.sign_pub, boxPub: c.box_pub))
}

@Test func accountCertificate() throws {
  let a = v.account_certificate
  #expect(try AccountCertificate.input(userId: a.user_id, accountId: a.account_id, signPub: a.sign_pub, boxPub: a.box_pub).hex == a.signing_input)
  #expect(AccountCertificate.verify(cert: a.signature, userId: a.user_id, accountId: a.account_id, signPub: a.sign_pub, boxPub: a.box_pub))
  // The attack it stops: the known sign_pub with another box_pub.
  #expect(!AccountCertificate.verify(cert: a.signature, userId: a.user_id, accountId: a.account_id, signPub: a.sign_pub, boxPub: v.device_certificate.box_pub))
  #expect(!AccountCertificate.verify(cert: a.signature, userId: "usr_2", accountId: a.account_id, signPub: a.sign_pub, boxPub: a.box_pub))
  #expect(!AccountCertificate.verify(cert: a.signature, userId: a.user_id, accountId: "acct_2", signPub: a.sign_pub, boxPub: a.box_pub))
  // The vector's 64-byte account key is the row's two keys, and our own self-certificate verifies.
  let key = try AccountKey(raw: Data(hex: a.account_key))
  #expect(key.signPub == a.sign_pub && key.boxPub == a.box_pub)
  let mine = try key.selfCertificate(userId: a.user_id, accountId: a.account_id)
  #expect(AccountCertificate.verify(cert: mine, userId: a.user_id, accountId: a.account_id, signPub: a.sign_pub, boxPub: a.box_pub))
}

@Test func groupKeyEnvelopeOpensAndVerifies() throws {
  let g = v.group_key_envelope
  let info = try Envelope.groupKeyInfo(groupId: g.group_id, keyVersion: g.key_version, deviceId: g.recipient_device_id)
  #expect(info.hex == g.info)
  let parsed = try Envelope.parse(b64(g.envelope))
  #expect(parsed.purpose == .groupKey && parsed.signerId == g.signer_id)
  #expect(try Envelope.signatureInput(info: info, body: parsed.body).hex == g.signature_input)
  #expect(Envelope.verify(parsed, info: info, signerSignPub: try PublicKeys.signing(g.signer_sign_pub)))
  #expect(try Envelope.open(parsed, info: info, recipient: boxKey(g.recipient_private_key)).hex == g.group_key)
  // Another version or another recipient does not open, and does not verify.
  let other = try Envelope.groupKeyInfo(groupId: g.group_id, keyVersion: g.key_version + 1, deviceId: g.recipient_device_id)
  #expect(throws: KeysError.badEnvelope) { try Envelope.open(parsed, info: other, recipient: boxKey(g.recipient_private_key)) }
  #expect(!Envelope.verify(parsed, info: other, signerSignPub: try PublicKeys.signing(g.signer_sign_pub)))
}

@Test func accountKeyEnvelopeOpensAndVerifies() throws {
  let a = v.account_key_envelope
  let info = try Envelope.accountKeyInfo(userId: a.user_id, accountDeviceId: a.account_device_id, deviceId: a.recipient_device_id)
  #expect(info.hex == a.info)
  let parsed = try Envelope.parse(b64(a.envelope))
  #expect(parsed.purpose == .accountKey)
  #expect(Envelope.verify(parsed, info: info, signerSignPub: try PublicKeys.signing(a.signer_sign_pub)))
  #expect(try Envelope.open(parsed, info: info, recipient: boxKey(a.recipient_private_key)).hex == a.account_key)
}

@Test func envelopeRoundTripWithOurOwnSeal() throws {
  let g = v.group_key_envelope
  let info = try Envelope.groupKeyInfo(groupId: g.group_id, keyVersion: g.key_version, deviceId: g.recipient_device_id)
  let signer = signKey(g.signer_private_key)
  let made = try Envelope.make(purpose: .groupKey, info: info, recipientBoxPub: try PublicKeys.box(g.recipient_box_pub), key: Data(hex: g.group_key), signerId: g.signer_id, signer: signer)
  let parsed = try Envelope.parse(made)
  #expect(Envelope.verify(parsed, info: info, signerSignPub: try PublicKeys.signing(g.signer_sign_pub)))
  #expect(try Envelope.open(parsed, info: info, recipient: boxKey(g.recipient_private_key)).hex == g.group_key)
  #expect(throws: KeysError.badInput) {
    try Envelope.make(purpose: .accountKey, info: info, recipientBoxPub: try PublicKeys.box(g.recipient_box_pub), key: Data(hex: g.group_key), signerId: g.signer_id, signer: signer)
  }
}

@Test func envelopeParseRefusesBadShapes() throws {
  let bytes = b64(v.group_key_envelope.envelope)
  var wrongVersion = bytes; wrongVersion[0] = 2
  var wrongPurpose = bytes; wrongPurpose[1] = 3
  for bad in [wrongVersion, wrongPurpose, bytes.dropLast(), bytes + Data([0]), Data(bytes.prefix(60))] {
    #expect(throws: KeysError.badEnvelope) { try Envelope.parse(Data(bad)) }
  }
}

@Test func sealedResultOpens() throws {
  let s = v.sealed_result
  #expect(try SealedResult.info(jobId: s.job_id, deviceId: s.device_id).hex == s.info)
  let plain = try SealedResult.open(b64(s.sealed), jobId: s.job_id, deviceId: s.device_id, recipient: boxKey(s.device_private_key))
  #expect(String(decoding: plain, as: UTF8.self) == s.plaintext_utf8)
  #expect(throws: KeysError.badSealed) { try SealedResult.open(b64(s.sealed), jobId: "job_2", deviceId: s.device_id, recipient: boxKey(s.device_private_key)) }
}

@Test func recoveryWrapKeyAndBlob() throws {
  let r = v.recovery
  let wrapKey = try Recovery.wrapKey(entropy: Data(hex: r.entropy), userId: r.user_id)
  #expect(wrapKey.withUnsafeBytes { Data($0) }.hex == r.wrap_key)
  #expect(try Recovery.aad(userId: r.user_id, accountDeviceId: r.account_device_id).hex == r.aad)
  let blob = try Recovery.wrap(accountKey: Data(hex: r.account_key), wrapKey: wrapKey, userId: r.user_id, accountDeviceId: r.account_device_id, nonce: Data(hex: r.nonce))
  #expect(Base64URL.encode(blob) == r.blob)
  #expect(try Recovery.unwrap(b64(r.blob), wrapKey: wrapKey, userId: r.user_id, accountDeviceId: r.account_device_id).hex == r.account_key)
  #expect(throws: KeysError.badRecovery) { try Recovery.unwrap(b64(r.blob), wrapKey: wrapKey, userId: "usr_2", accountDeviceId: r.account_device_id) }
}

@Test func lockedContent() throws {
  let c = v.content
  let objectContext = try context(c.context_label, c.context_fields)
  #expect(objectContext.hex == c.context)
  let key = SymmetricKey(data: try Data(hex: c.key))
  let locked = try LockedContent.lock(key: key, keyVersion: c.key_version, objectContext: objectContext, plaintext: Data(c.plaintext_utf8.utf8), nonce: Data(hex: c.nonce))
  #expect(Base64URL.encode(locked) == c.locked)
  #expect(try LockedContent.keyVersion(locked) == c.key_version)
  #expect(String(decoding: try LockedContent.unlock(key: key, objectContext: objectContext, locked: locked), as: UTF8.self) == c.plaintext_utf8)
  let otherContext = try context(c.context_label, ["grp_2"] + c.context_fields.dropFirst())
  #expect(throws: KeysError.badContent) { try LockedContent.unlock(key: key, objectContext: otherContext, locked: locked) }
}

@Test func rfc9180VectorOpens() throws {
  let t = try readVectors("rfc9180-p256-sha256-aes256gcm-base.json", as: Rfc9180.self)
  let sk = try P256.KeyAgreement.PrivateKey(rawRepresentation: Data(hex: t.skRm))
  #expect(sk.publicKey.x963Representation.hex == t.pkRm)
  var recipient = try HPKE.Recipient(privateKey: sk, ciphersuite: .P256_SHA256_AES_GCM_256, info: Data(hex: t.info), encapsulatedKey: Data(hex: t.enc))
  let first = try #require(t.encryptions.first)
  #expect(try recipient.open(Data(hex: first.ct), authenticating: Data(hex: first.aad)).hex == first.pt)
}

@Test func wycheproofEcdsaP1363() throws {
  let w = try readVectors("wycheproof-ecdsa-secp256r1-sha256-p1363.json", as: Wycheproof.self)
  var count = 0
  for group in w.testGroups {
    let key = try P256.Signing.PublicKey(x963Representation: Data(hex: group.publicKey.uncompressed))
    for test in group.tests {
      count += 1
      let ok = verifyP256(key, signature: try Data(hex: test.sig), message: try Data(hex: test.msg))
      #expect(ok == (test.result == "valid"), "tcId \(test.tcId)")
    }
  }
  #expect(count == w.numberOfTests && count == 262)
}

@Test func base64urlIsStrict() throws {
  #expect(Base64URL.encode(Data([0xfb, 0xff])) == "-_8")
  #expect(try Base64URL.decode("-_8") == Data([0xfb, 0xff]))
  for bad in ["-_8=", "+/8", "A", "-_9", "a b"] {
    #expect(throws: KeysError.badBase64URL) { try Base64URL.decode(bad) }
  }
  #expect(throws: KeysError.badPublicKey) { try PublicKeys.signing(Base64URL.encode(Data([4] + Array(repeating: 1, count: 64)))) }
}

@Test func contextRefusesBadLabels() {
  for label in ["", "Request", "a_b", String(repeating: "a", count: 33)] {
    #expect(throws: KeysError.badLabel) { try context(label, []) }
  }
  #expect(throws: KeysError.badId) { try checkId(String(repeating: "a", count: 65)) }
}
