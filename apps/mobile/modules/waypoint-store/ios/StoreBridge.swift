import Foundation
import StoreKit

// StoreKit 2 calls the module makes, as plain dictionaries for JavaScript. Only verified transactions are passed on;
// the server checks Apple's signature again (POST /v1/purchases/apple).
enum StoreBridge {
  static func kind(_ type: Product.ProductType) -> String {
    switch type {
    case .consumable: return "consumable"
    case .nonConsumable: return "non_consumable"
    case .autoRenewable: return "subscription"
    default: return "other"
    }
  }

  static func products(_ ids: [String]) async throws -> [[String: Any]] {
    try await Product.products(for: ids).map { p in
      ["id": p.id, "displayName": p.displayName, "displayPrice": p.displayPrice, "kind": kind(p.type), "familyShareable": p.isFamilyShareable]
    }
  }

  static func view(_ result: VerificationResult<Transaction>) -> [String: Any]? {
    guard case .verified(let t) = result else { return nil }
    return ["jws": result.jwsRepresentation, "transactionId": String(t.id), "productId": t.productID, "familyShared": t.ownershipType == .familyShared]
  }

  static func purchaseResult(_ result: Product.PurchaseResult) -> [String: Any] {
    switch result {
    case .success(let verification):
      guard let transaction = view(verification) else { return ["status": "unverified"] }
      return ["status": "purchased", "transaction": transaction]
    case .userCancelled: return ["status": "cancelled"]
    case .pending: return ["status": "pending"]
    @unknown default: return ["status": "cancelled"]
    }
  }

  static func collect(_ sequence: Transaction.Transactions) async -> [[String: Any]] {
    var out: [[String: Any]] = []
    for await result in sequence {
      if let t = view(result) { out.append(t) }
    }
    return out
  }

  static func finish(_ transactionId: String) async -> Bool {
    for await result in Transaction.unfinished {
      if case .verified(let t) = result, String(t.id) == transactionId {
        await t.finish()
        return true
      }
    }
    return false
  }

  static func restore() async throws -> [[String: Any]] {
    try await AppStore.sync()
    return await collect(Transaction.currentEntitlements)
  }
}
