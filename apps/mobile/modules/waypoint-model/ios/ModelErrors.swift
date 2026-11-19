import Foundation
import FoundationModels

// Maps a model error to the short code JavaScript sees as error.code.
func modelErrorCode(_ error: Error) -> String {
  if let e = error as? LanguageModelSession.GenerationError {
    switch e {
    case .exceededContextWindowSize: return "context_too_long"
    case .guardrailViolation, .refusal: return "declined"
    case .rateLimited, .concurrentRequests: return "busy"
    case .unsupportedLanguageOrLocale: return "unsupported_language"
    case .assetsUnavailable: return "unavailable"
    default: return "failed"
    }
  }
  if #available(iOS 27, *) {
    if let e = error as? LanguageModelError {
      switch e {
      case .contextSizeExceeded: return "context_too_long"
      case .guardrailViolation, .refusal: return "declined"
      case .rateLimited: return "busy"
      case .unsupportedLanguageOrLocale: return "unsupported_language"
      default: return "failed"
      }
    }
  }
  return "failed"
}
