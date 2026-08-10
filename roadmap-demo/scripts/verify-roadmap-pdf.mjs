import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PDF_RUNTIME } from "../src/pdf-runtime.js";
import { allowedCategoriesForTier } from "../src/roadmap-policy.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(readFileSync(join(projectRoot, "tests/fixtures/pdf-runtime.json"), "utf8"));
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const tier = arg("--tier", "premium");
if (!["premium", "standard"].includes(tier)) throw new Error(`Unsupported verification tier: ${tier}`);
const tierLabel = tier === "premium" ? "Premium" : "Standard";
const outputStem = tier === "premium" ? "ANP-roadmap-verified" : `ANP-roadmap-${tier}-verified`;
const expectedCategoryLabels = allowedCategoriesForTier(tier).map(({ label }) => label);
const url = arg("--url", "http://127.0.0.1:4173/");
const pdfPath = resolve(projectRoot, arg("--output", `output/pdf/${outputStem}.pdf`));
const previewBase = resolve(projectRoot, arg("--preview", `output/preview/${outputStem}`));
const reportPath = resolve(projectRoot, arg("--report", `output/pdf/${outputStem}.qa.json`));
const profileRoot = join(tmpdir(), "anp-roadmap-pdf");
mkdirSync(profileRoot, { recursive: true });
const profileDir = mkdtempSync(join(profileRoot, "pdf-harness-profile-"));
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function findPdftoppm() {
  const explicit = process.env.PDFTOPPM_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  if (process.platform !== "win32") return "pdftoppm";
  const listed = run("where.exe", ["pdftoppm"]).split(/\r?\n/).find(Boolean);
  if (!listed) throw new Error("pdftoppm was not found");
  if (listed.toLowerCase().endsWith(".cmd")) {
    const bundled = resolve(dirname(listed), "..", "..", "native", "poppler", "Library", "bin", "pdftoppm.exe");
    if (existsSync(bundled)) return bundled;
  }
  return listed;
}

async function waitForFile(path, timeoutMs = 10_000) {
  const started = Date.now();
  while (!existsSync(path)) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${path}`);
    await wait(50);
  }
}

async function connectCdp(webSocketUrl, onEvent) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 0;
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    onEvent(message);
  });
  return {
    send(method, params = {}) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolveRequest, rejectRequest) => pending.set(id, { resolve: resolveRequest, reject: rejectRequest }));
    },
    close: () => socket.close(),
  };
}

if (fixture.family !== PDF_RUNTIME.family || fixture.major !== PDF_RUNTIME.major
  || JSON.stringify(fixture.profile) !== JSON.stringify(PDF_RUNTIME.profile)) {
  throw new Error("PDF runtime fixture and src/pdf-runtime.js do not match");
}
if (!existsSync(fixture.executable)) throw new Error(`Managed Chrome not found: ${fixture.executable}`);
const escapedChrome = fixture.executable.replaceAll("'", "''");
const installedVersion = run("powershell.exe", ["-NoProfile", "-Command", `(Get-Item -LiteralPath '${escapedChrome}').VersionInfo.ProductVersion`]).trim();
if (Number(installedVersion.split(".")[0]) !== fixture.major) {
  throw new Error(`Managed Chrome ${installedVersion} does not match required major ${fixture.major}`);
}
const response = await fetch(url);
if (!response.ok) throw new Error(`Roadmap URL returned ${response.status}: ${url}`);
if (!resolve(profileDir).startsWith(`${resolve(tmpdir())}${sep}`)) throw new Error("Unsafe PDF harness profile path");
mkdirSync(dirname(pdfPath), { recursive: true });
mkdirSync(dirname(previewBase), { recursive: true });

const chrome = spawn(fixture.executable, [
  "--headless=new",
  "--disable-gpu",
  "--disable-extensions",
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-debugging-port=0",
  `--user-data-dir=${profileDir}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
const chromeClosed = new Promise((resolveClose) => chrome.once("close", resolveClose));
let chromeError = "";
chrome.stderr.on("data", (chunk) => { chromeError += chunk; });
let cdp;
let status;
let errors;
const browserLogs = [];
let editorReady = false;

try {
  const portFile = join(profileDir, "DevToolsActivePort");
  await waitForFile(portFile);
  const [port] = readFileSync(portFile, "utf8").trim().split(/\r?\n/);
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((result) => result.json());
  const page = targets.find(({ type }) => type === "page");
  if (!page) throw new Error("Managed Chrome did not expose a page target");
  cdp = await connectCdp(page.webSocketDebuggerUrl, ({ method, params }) => {
    if (method === "Runtime.exceptionThrown") {
      browserLogs.push({ source: "runtime", text: params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? method, url: "" });
    }
    if (method === "Log.entryAdded" && ["warning", "error"].includes(params.entry?.level)) {
      const entry = params.entry;
      const expectedPreviewApiMiss = !editorReady
        && entry.url?.includes("/api/roadmaps?limit=50&offset=0")
        && entry.text.includes("404");
      if (!expectedPreviewApiMiss) browserLogs.push({ source: entry.source, text: entry.text, url: entry.url ?? "" });
    }
  });
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Page.enable");
  const version = await cdp.send("Browser.getVersion");
  if (!version.product?.startsWith(`Chrome/${fixture.major}.`)) throw new Error(`Unexpected CDP runtime: ${version.product}`);
  await cdp.send("Page.navigate", { url });

  const editorStarted = Date.now();
  do {
    const result = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const editorInput = document.querySelector(".authoring-header input");
        if (editorInput) {
          const programInputs = document.querySelectorAll(".program-row input");
          const programTitleInput = programInputs[0];
          if (!programTitleInput) {
            document.querySelector(".authoring-header button")?.click();
            return "editor-adding-program";
          }
          const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          setValue.call(editorInput, "올인원 검증");
          editorInput.dispatchEvent(new Event("input", { bubbles: true }));
          setValue.call(programTitleInput, "Road 검증");
          programTitleInput.dispatchEvent(new Event("input", { bubbles: true }));
          setValue.call(programInputs[3], "1000000");
          programInputs[3].dispatchEvent(new Event("input", { bubbles: true }));
          return "editor";
        }
        const tierButton = [...document.querySelectorAll(".tier-choice__actions button")]
          .find((button) => button.textContent.trim() === ${JSON.stringify(tierLabel)});
        if (tierButton) {
          tierButton.click();
          return "tier";
        }
        const newRoadmapButton = document.querySelector("main.catalog-panel .catalog-heading .button-primary");
        if (newRoadmapButton) {
          newRoadmapButton.click();
          return "library";
        }
        return "loading";
      })()`,
      returnByValue: true,
    });
    if (result.result.value === "editor") break;
    if (Date.now() - editorStarted > 15_000) throw new Error(`Timed out entering the ${tierLabel} roadmap editor; surface=${result.result.value}`);
    await wait(100);
  } while (true);
  editorReady = true;

  const surfaceResult = await cdp.send("Runtime.evaluate", {
    expression: `(() => ({
      tier: document.querySelector(".tier-badge--editor")?.textContent.trim(),
      categories: [...document.querySelectorAll(".preview-stage .roadmap-section__label")].map((node) => node.textContent.trim()),
    }))()`,
    returnByValue: true,
  });
  const surface = surfaceResult.result.value;
  if (surface?.tier !== tierLabel || JSON.stringify(surface?.categories) !== JSON.stringify(expectedCategoryLabels)) {
    throw new Error(`Unexpected ${tierLabel} authoring surface: ${JSON.stringify(surface)}`);
  }

  const started = Date.now();
  do {
    const result = await cdp.send("Runtime.evaluate", {
      expression: "(() => { const main = document.querySelector('.preview-stage'); return { status: main?.dataset.pdfStatus, errors: main?.dataset.pdfErrors }; })()",
      returnByValue: true,
    });
    ({ status, errors } = result.result.value ?? {});
    if (status === "ready" || status === "blocked") break;
    if (Date.now() - started > 15_000) throw new Error(`Timed out waiting for PDF preflight; status=${status}`);
    await wait(100);
  } while (true);
  if (status !== "ready" || errors !== "") throw new Error(`PDF preflight is ${status}; errors=${errors}`);
  if (browserLogs.length) {
    const details = browserLogs.map(({ source, text, url: entryUrl }) => `${source}${entryUrl ? ` ${entryUrl}` : ""}: ${text}`).join(" | ");
    throw new Error(`Browser console errors: ${details}`);
  }

  const printed = await cdp.send("Page.printToPDF", {
    landscape: true,
    displayHeaderFooter: false,
    printBackground: true,
    preferCSSPageSize: true,
    scale: 1,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
  });
  writeFileSync(pdfPath, Buffer.from(printed.data, "base64"));
} finally {
  let shutdownError;
  if (cdp) {
    try {
      await cdp.send("Browser.close");
    } catch (error) {
      shutdownError = error;
    } finally {
      cdp.close();
    }
  }
  const closed = await Promise.race([chromeClosed.then(() => true), wait(3_000).then(() => false)]);
  if (!closed) {
    chrome.kill();
    await chromeClosed;
  }
  rmSync(profileDir, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
  if (shutdownError) throw shutdownError;
}
if (!existsSync(pdfPath)) throw new Error(`PDF was not created: ${pdfPath}\n${chromeError}`);

const python = process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3");
const pdfJson = run(python, ["-c", [
  "import json, sys",
  "from pypdf import PdfReader",
  "reader = PdfReader(sys.argv[1])",
  "page = reader.pages[0]",
  "text = '\\n'.join((item.extract_text() or '') for item in reader.pages)",
  "print(json.dumps({'pages': len(reader.pages), 'width': float(page.mediabox.width), 'height': float(page.mediabox.height), 'text': text}))",
].join(";"), pdfPath]);
const pdf = JSON.parse(pdfJson);
if (pdf.pages !== 1 || Math.abs(pdf.width - 841.92) > 0.1 || Math.abs(pdf.height - 594.96) > 0.1) {
  throw new Error(`Expected one A4 landscape page; got ${pdf.pages} page(s), ${pdf.width} x ${pdf.height} pt`);
}
for (const hiddenText of ["ANP 연간 로드맵 제작", "사업 추가", "금액(원)", "출력 기준:", "Premium", "Standard"]) {
  if (pdf.text.includes(hiddenText)) throw new Error(`no-print content leaked into PDF: ${hiddenText}`);
}
for (const requiredText of ["올인원", "Road", "주식회사", "advisor@anpc.co.kr"]) {
  if (!pdf.text.includes(requiredText)) throw new Error(`Required PDF text is missing: ${requiredText}`);
}

const rawPdf = readFileSync(pdfPath).toString("latin1");
const fonts = [...rawPdf.matchAll(/\/FontName\s*\/([^\s/<>\[\]()]+)/g)].map((match) => match[1]);
for (const requiredFont of ["NanumSquare_acR", "NanumSquare_acB", "NanumSquare_acEB", "Pretendard-Regular", "Arial-BoldMT"]) {
  if (!fonts.some((font) => font.includes(requiredFont))) throw new Error(`Required embedded font is missing: ${requiredFont}`);
}

const pdftoppm = findPdftoppm();
run(pdftoppm, ["-png", "-r", "150", "-singlefile", pdfPath, previewBase]);
const previewPath = `${previewBase}.png`;
if (!existsSync(previewPath)) throw new Error(`PDF preview was not created: ${previewPath}`);

const report = {
  result: "passed",
  tier,
  url,
  runtime: { family: fixture.family, product: fixture.product, version: installedVersion, major: fixture.major },
  profile: fixture.profile,
  preflight: { status, errors: [], browserLogs },
  pdf: { path: pdfPath, pages: pdf.pages, widthPt: pdf.width, heightPt: pdf.height, embeddedFonts: fonts },
  noPrintContentAbsent: true,
  preview: { path: previewPath, dpi: 150 },
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
