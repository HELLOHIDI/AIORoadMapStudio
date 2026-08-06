export const PDF_RUNTIME = Object.freeze({
  family: "Chromium",
  major: 150,
  profile: Object.freeze({
    paper: "A4",
    orientation: "landscape",
    scale: 100,
    margins: "none",
    backgroundGraphics: true,
    headersAndFooters: false,
  }),
});

export function detectPdfRuntime(navigatorLike = globalThis.navigator) {
  const brands = navigatorLike?.userAgentData?.brands ?? [];
  const brand = brands.find(({ brand: name }) => /Chromium|Google Chrome|Microsoft Edge/.test(name));
  const userAgent = navigatorLike?.userAgent ?? "";
  const match = brand?.version?.match(/^(\d+)/) ?? userAgent.match(/(?:Chrome|Chromium|Edg)\/(\d+)/);
  const major = match ? Number(match[1]) : null;
  return { family: major == null ? "Unknown" : "Chromium", major };
}

export function checkPdfRuntime(navigatorLike, contract = PDF_RUNTIME) {
  const runtime = detectPdfRuntime(navigatorLike);
  return {
    runtime,
    supported: runtime.family === contract.family && runtime.major === contract.major,
  };
}
