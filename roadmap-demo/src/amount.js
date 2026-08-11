export function formatAmount(won) {
  if (won == null) return "";
  if (!Number.isSafeInteger(won) || won <= 0) {
    throw new RangeError("amountKrw must be a positive safe integer");
  }

  if (won >= 100_000_000) {
    return `${Math.round(won / 10_000_000) / 10}억원`;
  }

  if (won >= 1_000_000) {
    return `${Math.round(won / 1_000_000)}백만 원`;
  }

  if (won % 10_000 === 0) {
    return `${won / 10_000}만 원`;
  }

  return `${won.toLocaleString("ko-KR")}원`;
}
