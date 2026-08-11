function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function formatCatalogBulletText(value) {
  return normalizeWhitespace(value)
    .replace(/(^|\n)[-•·][ \t]+(?=\S)/g, "$1- ")
    .trim();
}

export function classifyCatalogReadability(value) {
  const source = String(value ?? "");
  const whitespace = normalizeWhitespace(source);
  const normalized = formatCatalogBulletText(source);
  if (normalized === source) return { kind: "ambiguous-keep-prose", value: normalized };
  return {
    kind: normalized !== whitespace ? "safe-rewrite" : "whitespace-only",
    value: normalized,
  };
}
