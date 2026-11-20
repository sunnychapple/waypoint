import Foundation

// Reads the published vectors from packages/crypto/test/vectors (docs/security.md section 18). They are not copied.
func readVectors<T: Decodable>(_ name: String, as: T.Type) throws -> T {
  var url = URL(fileURLWithPath: #filePath)
  for _ in 0..<7 { url.deleteLastPathComponent() } // Tests, ios, waypoint-keys, modules, mobile, apps → repo root
  let file = url.appendingPathComponent("packages/crypto/test/vectors/\(name)")
  return try JSONDecoder().decode(T.self, from: try Data(contentsOf: file))
}

struct WaypointV1: Decodable {
  struct Context: Decodable { let label: String; let fields: [String]; let bytes: String }
  struct Request: Decodable {
    let method: String, target: String, deviceId: String, timestamp: Int64, nonce: String, bodySha256: String
    let body_utf8: String, signing_input: String, device_private_key: String, device_sign_pub: String, signature: String
  }
  struct PairingV: Decodable {
    let new_sign_pub: String, new_box_pub: String, new_nonce: String, approver_sign_pub: String, approver_nonce: String
    let commitment: String, code: String
  }
  struct Certificate: Decodable {
    let user_id: String, device_id: String, sign_pub: String, box_pub: String, signing_input: String
    let account_private_key: String, account_sign_pub: String, signature: String
  }
  struct GroupEnvelope: Decodable {
    let group_id: String, key_version: Int, recipient_device_id: String, recipient_private_key: String, recipient_box_pub: String
    let group_key: String, signer_id: String, signer_private_key: String, signer_sign_pub: String, info: String
    let signature_input: String, envelope: String
  }
  struct AccountEnvelope: Decodable {
    let user_id: String, account_device_id: String, recipient_device_id: String, recipient_private_key: String
    let account_key: String, signer_id: String, signer_sign_pub: String, info: String, envelope: String
  }
  struct Sealed: Decodable {
    let job_id: String, device_id: String, device_private_key: String, device_box_pub: String, info: String
    let plaintext_utf8: String, sealed: String
  }
  struct RecoveryV: Decodable {
    let entropy: String, user_id: String, account_device_id: String, wrap_key: String, aad: String
    let account_key: String, nonce: String, blob: String
  }
  struct Content: Decodable {
    let key: String, key_version: UInt32, context: String, context_label: String, context_fields: [String]
    let nonce: String, plaintext_utf8: String, locked: String
  }
  let context: Context
  let request: Request
  let pairing: PairingV
  let device_certificate: Certificate
  let group_key_envelope: GroupEnvelope
  let account_key_envelope: AccountEnvelope
  let sealed_result: Sealed
  let recovery: RecoveryV
  let content: Content
}

struct Rfc9180: Decodable {
  struct Encryption: Decodable { let aad: String; let ct: String; let pt: String }
  let info: String, skRm: String, pkRm: String, enc: String
  let encryptions: [Encryption]
}

struct Wycheproof: Decodable {
  struct Group: Decodable {
    struct Key: Decodable { let uncompressed: String }
    struct Case: Decodable { let tcId: Int; let msg: String; let sig: String; let result: String }
    let publicKey: Key
    let tests: [Case]
  }
  let numberOfTests: Int
  let testGroups: [Group]
}
