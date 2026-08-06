import { buildRoadmapLayout } from "./roadmap-policy.js";
import { checkPdfRuntime, PDF_RUNTIME } from "./pdf-runtime.js";

const A4_LANDSCAPE_PX = Object.freeze({ width: 297 / 25.4 * 96, height: 210 / 25.4 * 96 });
const FONT_CHECKS = Object.freeze([
  '400 7pt "NanumSquare AC"',
  '700 7pt "NanumSquare AC"',
  '800 16pt "NanumSquare AC"',
  '400 4pt "Pretendard"',
]);

const messages = {
  E_PDF_RUNTIME: `PDF 출력은 관리형 Chromium ${PDF_RUNTIME.major}에서만 허용됩니다.`,
  E_FONT_NOT_READY: "PDF에 필요한 폰트를 불러오지 못했습니다.",
  E_ASSET_MISSING: "ANP 로고를 불러오지 못했습니다.",
  E_LABEL_OVERFLOW: "라벨 또는 막대가 A4 시트 경계를 벗어났습니다.",
  E_VISUAL_COLLISION: "같은 행의 라벨 또는 막대가 서로 겹칩니다.",
  E_PAGE_OVERFLOW: "로드맵이 A4 가로 1페이지 영역을 초과했습니다.",
};

const issue = (code, details) => ({ code, message: messages[code], details });
const rect = (value) => ({ left: value.left, right: value.right, top: value.top, bottom: value.bottom });
const visualRects = (event) => [event.label ?? event.copy, event.amount, event.bar].filter(Boolean);

export function rectsOverlap(a, b, tolerance = 0.5) {
  return a.left < b.right - tolerance
    && b.left < a.right - tolerance
    && a.top < b.bottom - tolerance
    && b.top < a.bottom - tolerance;
}

export function rectInside(inner, outer, tolerance = 0.75) {
  return inner.left >= outer.left - tolerance
    && inner.right <= outer.right + tolerance
    && inner.top >= outer.top - tolerance
    && inner.bottom <= outer.bottom + tolerance;
}

export function inspectRoadmapGeometry({ sheet, lanes }) {
  const errors = [];
  const expected = A4_LANDSCAPE_PX;
  if (sheet.scrollWidth - sheet.clientWidth > 1
    || sheet.scrollHeight - sheet.clientHeight > 1
    || Math.abs(sheet.rect.right - sheet.rect.left - expected.width) > 1
    || Math.abs(sheet.rect.bottom - sheet.rect.top - expected.height) > 1) {
    errors.push(issue("E_PAGE_OVERFLOW"));
  }

  const events = lanes.flat();
  for (const event of events) {
    if (visualRects(event).some((item) => !rectInside(item, sheet.rect))) {
      errors.push(issue("E_LABEL_OVERFLOW", event.id));
    }
  }
  for (let left = 0; left < events.length; left += 1) {
    for (let right = left + 1; right < events.length; right += 1) {
      const a = events[left];
      const b = events[right];
      if (visualRects(a).some((aRect) => visualRects(b).some((bRect) => rectsOverlap(aRect, bRect)))) {
        errors.push(issue("E_VISUAL_COLLISION", `${a.id}:${b.id}`));
      }
    }
  }
  return errors;
}

function readGeometry(root) {
  const sheetElement = root.querySelector(".roadmap-sheet");
  if (!sheetElement) return null;
  const sheetRect = rect(sheetElement.getBoundingClientRect());
  const lanes = [...root.querySelectorAll(".roadmap-lane")].map((lane) => (
    [...lane.querySelectorAll(".roadmap-event")].map((event) => {
      const label = event.querySelector(".roadmap-event__copy > span");
      const amount = event.querySelector(".roadmap-event__copy > sup");
      return {
        id: event.dataset.programId,
        label: label ? rect(label.getBoundingClientRect()) : null,
        amount: amount ? rect(amount.getBoundingClientRect()) : null,
        bar: rect(event.querySelector(".roadmap-event__bar").getBoundingClientRect()),
      };
    })
  ));
  return {
    sheet: {
      rect: sheetRect,
      clientWidth: sheetElement.clientWidth,
      clientHeight: sheetElement.clientHeight,
      scrollWidth: sheetElement.scrollWidth,
      scrollHeight: sheetElement.scrollHeight,
    },
    lanes,
  };
}

function afterRender(root) {
  const requestFrame = root.defaultView?.requestAnimationFrame?.bind(root.defaultView);
  return requestFrame ? new Promise((resolve) => requestFrame(() => requestFrame(resolve))) : Promise.resolve();
}

export async function runPdfPreflight({ roadmapDocument, root = globalThis.document, navigatorLike = globalThis.navigator }) {
  const layout = buildRoadmapLayout(roadmapDocument);
  const errors = [...layout.errors];
  const runtimeCheck = checkPdfRuntime(navigatorLike);
  if (!runtimeCheck.supported) errors.push(issue("E_PDF_RUNTIME", runtimeCheck.runtime));

  if (!root?.fonts) {
    errors.push(issue("E_FONT_NOT_READY"));
  } else {
    await root.fonts.ready;
    if (FONT_CHECKS.some((font) => !root.fonts.check(font))) errors.push(issue("E_FONT_NOT_READY"));
  }

  const logo = root?.querySelector?.(".brand-logo");
  if (!logo?.complete || logo.naturalWidth <= 0) errors.push(issue("E_ASSET_MISSING"));

  await afterRender(root);
  const geometry = root ? readGeometry(root) : null;
  errors.push(...(geometry ? inspectRoadmapGeometry(geometry) : [issue("E_PAGE_OVERFLOW")]));

  return { ok: errors.length === 0, errors, runtime: runtimeCheck.runtime, profile: PDF_RUNTIME.profile };
}
