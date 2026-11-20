import ExpoModulesCore
import StoreKit

// StoreKit 2 (docs/architecture.md flow 5). The app sends every verified transaction to POST /v1/purchases/apple and
// calls finish only after the server has it, so a purchase is never lost between Apple and our wallet.
public class WaypointStoreModule: Module {
  private var updates: Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    Name("WaypointStore")
    Events("onTransaction")

    // Renewals, Ask to Buy approvals and purchases made on another device arrive here. Start listening at once.
    OnCreate {
      self.updates = Task { [weak self] in
        for await result in Transaction.updates {
          if let transaction = StoreBridge.view(result) { self?.sendEvent("onTransaction", transaction) }
        }
      }
    }

    OnDestroy {
      self.updates?.cancel()
    }

    AsyncFunction("products") { (ids: [String]) async throws -> [[String: Any]] in
      try await StoreBridge.products(ids)
    }

    // appAccountToken is the server's user id (a UUID; PR 17 checks it), so Apple's notices name the same account.
    AsyncFunction("purchase") { (productId: String, appAccountToken: String) async throws -> [String: Any] in
      guard let token = UUID(uuidString: appAccountToken) else {
        throw Exception(name: "WaypointStore", description: "bad account token", code: "bad_token")
      }
      guard let product = try await Product.products(for: [productId]).first else {
        throw Exception(name: "WaypointStore", description: "unknown product", code: "unknown_product")
      }
      let scene = await MainActor.run { self.appContext?.utilities?.currentViewController()?.view.window?.windowScene }
      guard let scene else {
        throw Exception(name: "WaypointStore", description: "no window to show the purchase sheet", code: "no_window")
      }
      do {
        let result = try await product.purchase(confirmIn: scene, options: [.appAccountToken(token)])
        return StoreBridge.purchaseResult(result)
      } catch StoreKitError.userCancelled {
        return ["status": "cancelled"]
      } catch {
        throw Exception(name: "WaypointStore", description: error.localizedDescription, code: "purchase_failed")
      }
    }

    AsyncFunction("unfinishedTransactions") { () async -> [[String: Any]] in
      await StoreBridge.collect(Transaction.unfinished)
    }

    AsyncFunction("finish") { (transactionId: String) async -> Bool in
      await StoreBridge.finish(transactionId)
    }

    AsyncFunction("restore") { () async throws -> [[String: Any]] in
      try await StoreBridge.restore()
    }
  }
}
