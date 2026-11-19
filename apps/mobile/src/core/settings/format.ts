// "0 KB", "340 MB", "1.2 GB". Units are 1,000-based; one decimal from GB. A value that would round up to
// the next unit is shown in that unit ("1 MB", not "1000 KB").
export function bytesLabel(n: number): string {
  if (n < 999_500) return `${Math.round(n / 1_000)} KB`;
  if (n < 999_500_000) return `${Math.round(n / 1_000_000)} MB`;
  return `${(n / 1_000_000_000).toFixed(1)} GB`;
}

// "98%". Rounds down, so 999 of 1,000 reads 99%, not 100%. With no total there is nothing to index: 100%.
export function percentLabel(done: number, total: number): string {
  if (total === 0) return "100%";
  return `${Math.floor((done / total) * 100)}%`;
}
