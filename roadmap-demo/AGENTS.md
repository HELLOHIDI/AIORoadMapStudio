# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Preserve the Sites packaging and static-fallback contracts in `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs`. The Worker may add `/api/catalog-programs` handlers and D1 access for the approved shared-catalog feature, but unknown API/write requests must never fall through to the app shell. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Saved roadmap contract

- Start on the shared saved-roadmap list. A visitor can create a blank roadmap, open one, explicitly save it, or permanently delete it.
- Roadmaps are public and unauthenticated by current product decision. Keep the visible risk notice, API-boundary validation, bounded request size, and destructive confirmation.
- Persist the complete roadmap document through the existing Worker and `DB` binding. Preserve `laneIndex` and allow structurally valid but PDF-invalid drafts; PDF preflight still blocks output.
- Do not add autosave, browser storage, routing, ownership, history, duplication, trash, search, or another dependency for this MVP.
- Warn before leaving a dirty editor. Failed reads or writes must not replace or discard the in-memory document.
- Keep the saved-roadmap library and all controls out of print. Run `npm run test`, `npm run build`, and `npm run test:sites` before handoff.

## Roadmap demo design contract

- Deliverable: true A4 landscape, single-page PDF; the authoring UI must never appear in print.
- Fixed title: `올인원 컨설팅 서비스 연간 로드맵_{클라이언트명}`, NanumSquare AC ExtraBold 16pt.
- Header: supplied ANP Consulting logo on the left and `Road to funds` on the right in NanumSquare AC Regular 7pt; keep both 3-4pt above the table.
- Category order and row ceilings: 컨설팅 2, 사업화 4, 바우처 2, IP 2, 기업인증 1.
- Month/category headings: NanumSquare AC Bold 7pt. Program labels: `[구분] 사업명`, NanumSquare AC Bold 6pt.
- Amounts: Pretendard Regular 4pt; `N억원` at or above 1억원 and `N백만 원` below 1억원; CSS position `top: -8pt`.
- All PDF-canvas text uses `letter-spacing: 0`.
- Bars are 0.21cm high. Label text starts 0.5pt to the right of the bar and keeps a measured 2pt label-to-bar gap.
- Each category height is split into its fixed number of equal lanes; every event is bottom-aligned in its lane.
- Start/end months are used only for inclusive bar geometry and are not printed as text.
- Category colors are fixed: `#BFBFBF`, `#5B9BD5`, `#FFC000`, `#F86828`, `#70AD47`.
- Do not draw internal horizontal or vertical boundaries across the 1-12 month roadmap body.
- Footer copy is fixed: `주식회사 ANP컨설팅  |  서울시 강서구 공항대로45길75,제일빌딩 6층  |  E. advisor@anpc.co.kr`, NanumSquare AC Regular 7pt.
- Managed output runtime: Google Chrome/Chromium major 150 with A4, landscape, 100% scale, no margins, background graphics on, and headers/footers off.
- Any data, runtime, font, logo, collision, label-overflow, or page-overflow error blocks PDF output. Keep the policy and QA evidence in `src/pdf-runtime.js`, `tests/fixtures/pdf-runtime.json`, and `design-qa.md` synchronized.

## Shared business catalog UX contract

- `DESIGN.md` is the source of truth for authoring UI and catalog UX decisions; generated mockups are non-binding until explicitly approved.
- Keep one product screen with `로드맵 편집` and `사업 카탈로그` working modes. Show one mode at a time.
- Catalog mode opens on the saved-program list. `로드맵에 추가` is primary; `새 사업 등록` is secondary; master edit/delete are subordinate.
- Do not use a modal, drawer, separate route, or permanently expanded catalog below the roadmap.
- Selecting a master creates an independent roadmap copy. Later edits or deletion of either record must not mutate the other.
- Catalog controls and status must never appear in print or alter the A4 output contract.
- MVP catalog writes are shared and unauthenticated by explicit product decision. Keep API validation and visible failure handling; defer login, roles, approval, moderation, and feedback.
