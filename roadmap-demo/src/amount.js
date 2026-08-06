export function formatAmount(won) {
  if (won == null) return "";
  if (!Number.isSafeInteger(won) || won < 1_000_000) {
    throw new RangeError("amountKrw must be a safe integer of at least 1,000,000 KRW");
  }

  if (won >= 100_000_000) {
    return `${Math.round(won / 10_000_000) / 10}억원`;
  }

  return `${Math.round(won / 1_000_000)}백만 원`;
}
