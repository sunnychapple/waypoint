import type { ProductKind } from "@waypoint/contracts";

export type AppleProduct =
  | { kind: "own_it"; credits: number; appleType: "Non-Consumable" }
  | { kind: "plus"; period: "monthly" | "yearly"; appleType: "Auto-Renewable Subscription" }
  | { kind: "pack"; credits: number; appleType: "Consumable" };

export const PLUS_MONTHLY_CREDITS = 2000;

// App Store Connect product ids (docs/architecture.md section 7). Change these only together with App Store Connect.
export const APPLE_PRODUCTS: Readonly<Record<string, AppleProduct>> = {
  "waypoint.own_it": { kind: "own_it", credits: 2000, appleType: "Non-Consumable" },
  "waypoint.plus.monthly": { kind: "plus", period: "monthly", appleType: "Auto-Renewable Subscription" },
  "waypoint.plus.yearly": { kind: "plus", period: "yearly", appleType: "Auto-Renewable Subscription" },
  "waypoint.credits.1000": { kind: "pack", credits: 1000, appleType: "Consumable" },
  "waypoint.credits.5000": { kind: "pack", credits: 5000, appleType: "Consumable" },
  "waypoint.credits.20000": { kind: "pack", credits: 20000, appleType: "Consumable" },
};

export function appleProduct(productId: string): AppleProduct | undefined {
  return Object.hasOwn(APPLE_PRODUCTS, productId) ? APPLE_PRODUCTS[productId] : undefined;
}

// The purchases.kind value for a product.
export function purchaseKind(kind: ProductKind): "consumable" | "subscription" | "non_consumable" {
  return kind === "pack" ? "consumable" : kind === "plus" ? "subscription" : "non_consumable";
}

// ms plus whole calendar months in UTC; the day is clamped to the month's last day (Jan 31 + 1 -> Feb 28).
export function addMonths(ms: number, months: number): number {
  const d = new Date(ms);
  const month = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return Date.UTC(
    d.getUTCFullYear(),
    month,
    Math.min(d.getUTCDate(), lastDay),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  );
}
