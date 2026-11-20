import CryptoKit
import Foundation
import Testing
@testable import KeysCore

// Trezor's BIP-39 English vectors (github.com/trezor/python-mnemonic, vectors.json at b57a5ad7), every 16-byte entry.
private let trezor: [(String, String)] = [
  ("00000000000000000000000000000000", "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"),
  ("7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f", "legal winner thank year wave sausage worth useful legal winner thank yellow"),
  ("80808080808080808080808080808080", "letter advice cage absurd amount doctor acoustic avoid letter advice cage above"),
  ("ffffffffffffffffffffffffffffffff", "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"),
  ("9e885d952ad362caeb4efe34a8e91bd2", "ozone drill grab fiber curtain grace pudding thank cruise elder eight picnic"),
  ("c0ba5a8e914111210f2bd131f3d5e08d", "scheme spot photo card baby mountain device kick cradle pact join borrow"),
  ("23db8160a31d3e0dca3688ed941adbf3", "cat swing flag economy stadium alone churn speed unique patch report train"),
  ("f30f8c1da665478f49b001d94c5fc452", "vessel ladder alter error federal sibling chat ability sun glass valve picture"),
]

@Test func wordListIsTheOfficialFile() {
  #expect(bip39English.count == 2048)
  #expect(sha256(Data((bip39English.joined(separator: "\n") + "\n").utf8)).hex == Bip39.wordListSha256)
}

@Test func trezorVectorsBothWays() throws {
  for (hex, words) in trezor {
    #expect(try Bip39.words(entropy: Data(hex: hex)).joined(separator: " ") == words)
    #expect(try Bip39.entropy(words: words).hex == hex)
  }
}

@Test func wordsAreReadLooselyButCheckedStrictly() throws {
  let (hex, words) = trezor[4]
  #expect(try Bip39.entropy(words: "  " + words.uppercased().replacingOccurrences(of: " ", with: "\n ") + "\n").hex == hex)
  var swapped = words.split(separator: " ").map(String.init)
  swapped.swapAt(0, 1)
  #expect(throws: KeysError.badRecovery) { try Bip39.entropy(words: swapped.joined(separator: " ")) } // checksum
  #expect(throws: KeysError.badRecovery) { try Bip39.entropy(words: words.replacingOccurrences(of: "ozone", with: "ozzone")) } // not a word
  #expect(throws: KeysError.badRecovery) { try Bip39.entropy(words: String(words.dropLast(8))) } // 11 words
  #expect(throws: KeysError.badRecovery) { try Bip39.words(entropy: Data(count: 15)) }
}

@Test func recoveryKeyRoundTrip() throws {
  let account = AccountKey()
  let made = try RecoveryKey.make(account: account, userId: "usr_1", accountId: "acct_1")
  #expect(made.words.count == 12)
  #expect(made.blob.count == 124)
  let opened = try RecoveryKey.open(words: made.words.joined(separator: " "), blob: made.blob, userId: "usr_1", accountId: "acct_1", signPub: account.signPub, boxPub: account.boxPub)
  #expect(opened.raw == account.raw)
  // Another user, another account row, or other public keys: refused.
  #expect(throws: KeysError.badRecovery) { try RecoveryKey.open(words: made.words.joined(separator: " "), blob: made.blob, userId: "usr_2", accountId: "acct_1", signPub: account.signPub, boxPub: account.boxPub) }
  #expect(throws: KeysError.badRecovery) { try RecoveryKey.open(words: made.words.joined(separator: " "), blob: made.blob, userId: "usr_1", accountId: "acct_2", signPub: account.signPub, boxPub: account.boxPub) }
  let other = AccountKey()
  #expect(throws: KeysError.badRecovery) { try RecoveryKey.open(words: made.words.joined(separator: " "), blob: made.blob, userId: "usr_1", accountId: "acct_1", signPub: other.signPub, boxPub: account.boxPub) }
}

@Test func recoveryBlobMatchesTheVectorFormat() throws {
  // Fixed entropy gives fixed words; the blob opens with the same words (its nonce is random).
  let account = try AccountKey(raw: Data(repeating: 7, count: 32) + Data(repeating: 9, count: 32))
  let made = try RecoveryKey.make(account: account, userId: "usr_1", accountId: "acct_1", entropy: try Data(hex: trezor[0].0))
  #expect(made.words.joined(separator: " ") == trezor[0].1)
  #expect(try Base64URL.decode(made.blob).first == 1)
}

@Test func certifyAndOpenTheAccountEnvelope() throws {
  let account = AccountKey()
  let approver = P256.Signing.PrivateKey()
  let newSign = P256.Signing.PrivateKey()
  let newBox = P256.KeyAgreement.PrivateKey()
  let made = try account.certify(userId: "usr_1", accountId: "acct_1", deviceId: "dev_new", signPub: newSign.publicKeyText, boxPub: boxKeyText(newBox.publicKey), signerId: "dev_old", signer: approver)
  #expect(DeviceCertificate.verify(accountSignPub: account.signPub, cert: made.cert, userId: "usr_1", deviceId: "dev_new", signPub: newSign.publicKeyText, boxPub: boxKeyText(newBox.publicKey)))
  let opened = try AccountKey.open(envelope: made.envelope, userId: "usr_1", accountId: "acct_1", deviceId: "dev_new", signPub: account.signPub, boxPub: account.boxPub, trusted: ["dev_old": approver.publicKeyText], recipient: newBox)
  #expect(opened.raw == account.raw)
  // An untrusted signer, a signer under another key, or another account row: refused.
  #expect(throws: KeysError.badEnvelope) {
    try AccountKey.open(envelope: made.envelope, userId: "usr_1", accountId: "acct_1", deviceId: "dev_new", signPub: account.signPub, boxPub: account.boxPub, trusted: [:], recipient: newBox)
  }
  #expect(throws: KeysError.badEnvelope) {
    try AccountKey.open(envelope: made.envelope, userId: "usr_1", accountId: "acct_1", deviceId: "dev_new", signPub: account.signPub, boxPub: account.boxPub, trusted: ["dev_old": newSign.publicKeyText], recipient: newBox)
  }
  #expect(throws: KeysError.self) {
    try AccountKey.open(envelope: made.envelope, userId: "usr_1", accountId: "acct_2", deviceId: "dev_new", signPub: account.signPub, boxPub: account.boxPub, trusted: ["dev_old": approver.publicKeyText], recipient: newBox)
  }
  // The account key itself as signer (recovery).
  let selfMade = try account.certify(userId: "usr_1", accountId: "acct_1", deviceId: "dev_new", signPub: newSign.publicKeyText, boxPub: boxKeyText(newBox.publicKey), signerId: "acct_1", signer: account.sign)
  #expect(try AccountKey.open(envelope: selfMade.envelope, userId: "usr_1", accountId: "acct_1", deviceId: "dev_new", signPub: account.signPub, boxPub: account.boxPub, trusted: ["acct_1": account.signPub], recipient: newBox).raw == account.raw)
}

@Test func approverChecksTheCommitmentBeforeTheCode() throws {
  let sign = P256.Signing.PrivateKey().publicKeyText
  let box = boxKeyText(P256.KeyAgreement.PrivateKey().publicKey)
  let approver = P256.Signing.PrivateKey().publicKeyText
  let nN = Pairing.newNonce()
  let nA = Pairing.newNonce()
  let commitment = try Pairing.commitment(signPub: sign, boxPub: box, newNonce: nN)
  let code = try Pairing.approverCode(newSignPub: sign, newBoxPub: box, commitment: commitment, approverSignPub: approver, approverNonce: nA, newNonce: nN)
  #expect(code == (try Pairing.code(newSignPub: sign, newBoxPub: box, approverSignPub: approver, approverNonce: nA, newNonce: nN)))
  #expect(throws: KeysError.badCommitment) {
    try Pairing.approverCode(newSignPub: sign, newBoxPub: box, commitment: commitment, approverSignPub: approver, approverNonce: nA, newNonce: Pairing.newNonce())
  }
}
