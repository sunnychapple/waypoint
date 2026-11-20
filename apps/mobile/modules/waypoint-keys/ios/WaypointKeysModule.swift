import ExpoModulesCore

// This device's keys (docs/security.md section 19). Thin: the work is in IdentityStore.swift and Core/.
public class WaypointKeysModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WaypointKeys")

    Function("getDeviceKeys") { (userId: String) throws -> [String: Any]? in
      try coded { try KeysOps.getDeviceKeys(userId: userId) }
    }
    AsyncFunction("ensureDeviceKeys") { (userId: String, deviceId: String) throws -> [String: Any] in
      try coded { try KeysOps.ensureDeviceKeys(userId: userId, deviceId: deviceId) }
    }
    AsyncFunction("deleteDeviceKeys") { (userId: String) throws in
      try coded { try KeysOps.deleteDeviceKeys(userId: userId) }
    }
    AsyncFunction("ensureAccountKey") { (userId: String, accountId: String) throws -> [String: Any] in
      try coded { try KeysOps.ensureAccountKey(userId: userId, accountId: accountId) }
    }
    AsyncFunction("deleteAccountKey") { (userId: String) throws in
      try coded { try KeysOps.deleteAccountKey(userId: userId) }
    }
    AsyncFunction("startPairing") { (userId: String) throws -> String in
      try coded { try KeysOps.startPairing(userId: userId) }
    }
    AsyncFunction("signRequest") { (userId: String, method: String, target: String, deviceId: String, timestamp: Double, body: String) throws -> [String: Any] in
      try coded { try KeysOps.signRequest(userId: userId, method: method, target: target, deviceId: deviceId, timestamp: timestamp, body: body) }
    }
    AsyncFunction("openSealedResult") { (userId: String, jobId: String, sealed: String) throws -> String in
      try coded { try KeysOps.openSealedResult(userId: userId, jobId: jobId, sealed: sealed) }
    }
    // M27b: the account key, pairing, the recovery key and device removal (AccountOps.swift).
    Function("getAccountKey") { (userId: String) throws -> [String: Any]? in
      try coded { try KeysOps.getAccountKey(userId: userId) }
    }
    Function("newPairingNonce") { () -> String in
      Pairing.newNonce()
    }
    Function("pairingCode") { (newSignPub: String, newBoxPub: String, commitment: String, approverSignPub: String, approverNonce: String, newNonce: String) throws -> String in
      try coded {
        try Pairing.approverCode(
          newSignPub: newSignPub, newBoxPub: newBoxPub, commitment: commitment, approverSignPub: approverSignPub, approverNonce: approverNonce, newNonce: newNonce)
      }
    }
    Function("verifyCertificate") { (accountSignPub: String, cert: String, userId: String, deviceId: String, signPub: String, boxPub: String) -> Bool in
      DeviceCertificate.verify(accountSignPub: accountSignPub, cert: cert, userId: userId, deviceId: deviceId, signPub: signPub, boxPub: boxPub)
    }
    AsyncFunction("revealPairing") { (userId: String, approverSignPub: String, approverNonce: String) throws -> [String: Any] in
      try coded { try KeysOps.revealPairing(userId: userId, approverSignPub: approverSignPub, approverNonce: approverNonce) }
    }
    AsyncFunction("certifyDevice") { (userId: String, deviceId: String, signPub: String, boxPub: String, asAccount: Bool) throws -> [String: Any] in
      try coded { try KeysOps.certifyDevice(userId: userId, deviceId: deviceId, signPub: signPub, boxPub: boxPub, asAccount: asAccount) }
    }
    AsyncFunction("signRequestAsAccount") { (userId: String, method: String, target: String, timestamp: Double, body: String) throws -> [String: Any] in
      try coded { try KeysOps.signRequestAsAccount(userId: userId, method: method, target: target, timestamp: timestamp, body: body) }
    }
    AsyncFunction("makeRecoveryKey") { (userId: String) throws -> [String: Any] in
      try coded { try KeysOps.makeRecoveryKey(userId: userId) }
    }
    AsyncFunction("recoverAccountKey") { (userId: String, words: String, accountId: String, blob: String, signPub: String, boxPub: String) throws in
      try coded { try KeysOps.recoverAccountKey(userId: userId, words: words, accountId: accountId, blob: blob, signPub: signPub, boxPub: boxPub) }
    }
    AsyncFunction("adoptAccountKey") { (userId: String, accountId: String, signPub: String, boxPub: String, envelope: String, trusted: [String: String]) throws in
      try coded { try KeysOps.adoptAccountKey(userId: userId, accountId: accountId, signPub: signPub, boxPub: boxPub, envelope: envelope, trusted: trusted) }
    }
    AsyncFunction("rotateAccountKey") { (userId: String, accountId: String, devices: [[String: String]]) throws -> [String: Any] in
      try coded { try KeysOps.rotateAccountKey(userId: userId, accountId: accountId, devices: devices) }
    }
    AsyncFunction("finishAccountRotation") { (userId: String, accountId: String, keep: Bool) throws in
      try coded { try KeysOps.finishAccountRotation(userId: userId, accountId: accountId, keep: keep) }
    }
  }
}

// Our errors become an Exception whose code JavaScript reads as error.code.
private func coded<T>(_ body: () throws -> T) throws -> T {
  do {
    return try body()
  } catch let error as KeysModuleError {
    throw Exception(name: "WaypointKeys", description: error.message, code: error.code)
  } catch let error as KeysError {
    throw Exception(name: "WaypointKeys", description: "\(error)", code: "\(error)")
  } catch {
    throw Exception(name: "WaypointKeys", description: "key operation failed", code: "failed")
  }
}
