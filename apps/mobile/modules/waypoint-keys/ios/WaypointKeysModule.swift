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
  }
}

// Our errors become an Exception whose code JavaScript reads as error.code.
private func coded<T>(_ body: () throws -> T) throws -> T {
  do {
    return try body()
  } catch let error as KeysModuleError {
    throw Exception(name: "WaypointKeys", description: error.code, code: error.code)
  } catch let error as KeysError {
    throw Exception(name: "WaypointKeys", description: "\(error)", code: "\(error)")
  } catch {
    throw Exception(name: "WaypointKeys", description: "key operation failed", code: "failed")
  }
}
