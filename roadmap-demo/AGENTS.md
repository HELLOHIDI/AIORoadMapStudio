# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

## Authoritative GitHub and Sites delivery contract

- One Ultragoal request uses one Issue, one branch, and one PR. Keep the Issue self-contained; `.omx/` is not pushed.
- The PR must use `Refs #<issue>` and record pre-merge validation only. Never use an auto-closing keyword or put post-merge deployment facts in the PR.
- Before merge, run `npm test`, `npm run build`, and `npm run test:sites`. After merge, use the exact `origin/master` SHA to save a Sites version, deploy it privately, and post the SHA, version ID, deployment ID/status, private URL, and timestamp to the Issue.
- Close the Issue only after successful private deployment evidence exists. If validation, Sites, or comment posting fails, leave it open; a correction before completion uses another PR linked with `Refs #<issue>`.
- A new request after an Issue is closed starts a new Issue, branch, PR, and private deployment. Public or shared deployment requires explicit approval.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

## Product identity boundary

- Use `AIO Roadmap Studio` branding only in non-print product chrome, currently the top authoring toolbar, browser title, and favicon.
- Keep the existing `ANP Consulting` logo and identity unchanged inside the printable roadmap and client-facing PDF.
- Do not add AIO branding to exported documents, print styles, client-share metadata, or other client-facing output without a new explicit product decision.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Preserve the Sites packaging and static-fallback contracts in `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs`. The Worker may add `/api/catalog-programs` handlers and D1 access for the approved shared-catalog feature, but unknown API/write requests must never fall through to the app shell. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Saved roadmap contract

- Start on the shared saved-roadmap list. A visitor can create a blank roadmap, open one, explicitly save it, or permanently delete it.
- Roadmaps are public and unauthenticated by current product decision. Keep the visible risk notice, API-boundary validation, bounded request size, and destructive confirmation.
- Persist the complete roadmap document through the existing Worker and `DB` binding. Preserve `laneIndex` and allow structurally valid but PDF-invalid drafts; PDF preflight still blocks output.
- Do not add autosave, browser storage, routing, ownership, history, duplication, trash, search, or another dependency for this MVP.
- Warn before leaving a dirty editor. Failed reads or writes must not replace or discard the in-memory document.
- Keep the saved-roadmap library and all controls out of print. Run `npm run test`, `npm run build`, and `npm run test:sites` before handoff.

## Roadmap feedback contract

- Feedback belongs to a saved roadmap and a stable roadmap-program ID. Store it separately from the roadmap JSON so it never changes PDF/PPTX geometry or client-facing exports.
- Clicking or keyboard-activating a roadmap bar is the feedback entry point. Preserve drag/drop and ArrowUp/ArrowDown lane movement without accidental feedback activation after a drag.
- When a program has no feedback, show a compact authoring-only composer beside the selected bar. When feedback exists, show only a screen-only unresolved marker and open a non-modal inspector from the right; at narrow widths the inspector becomes a full-width lower panel. Never show a feedback or comment count on a roadmap bar.
- Keep the inspector minimal: program title, current state, chronological role/time/text timeline, and only the action available for the current state.
- The state flow is `수정 필요` → `수정 완료` → `해결`. Any visitor may create feedback, mark `수정 완료`, request rework, or confirm `해결`; do not require a password, session, or personal account.
- Feedback writes are shared and unauthenticated by explicit product decision. Keep request validation, the explicit feedback action header, state-transition checks, and visible failure handling.
- Feedback UI, selection outlines, and state markers are authoring-only and must remain excluded from print, PDF, PPTX, and ANP client-facing output.
- Failed feedback reads, writes, or authentication must leave the active in-memory roadmap unchanged. Removing a program must immediately hide its feedback from reads and remove its stale thread on the next roadmap save; deleting a roadmap must clean only its associated feedback.

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
- PDF output supports Chromium-based browsers, including ordinary Google Chrome. Keep A4, landscape, 100% scale, no margins, background graphics on, and headers/footers off.
- Any data, runtime, font, logo, collision, label-overflow, or page-overflow error blocks PDF output. Keep the policy and QA evidence in `src/pdf-runtime.js`, `tests/fixtures/pdf-runtime.json`, and `design-qa.md` synchronized.

## Native editable PPTX export contract

- Offer PPTX as a parallel export from roadmap editing without changing or replacing the managed PDF flow.
- Produce exactly one A4 landscape slide from the canonical roadmap document and resolved layout; never use a DOM screenshot or a full-slide bitmap.
- Keep the ANP logo as an independent image and create titles, months, category labels, program labels/amounts, notes, footer, table geometry, and program bars as native editable PowerPoint objects.
- Preserve the approved PDF colors, font names/sizes, margins, row heights, inclusive month geometry, and ANP-only client-document identity as closely as PowerPoint rendering permits. Never add AIO Roadmap Studio branding or authoring controls to the PPTX.
- Block PPTX generation on canonical document or layout errors, but do not couple the PPTX action to Chromium/PDF-runtime-only preflight checks.
- Name program objects deterministically from their program ID and role (`.text`, `.amount`, `.bar`) so a future importer can map them. Keep an amount in its own editable text object and position it from the measured approved-font label width; importing or synchronizing edited PPTX files is not part of this contract.
- The PPTX references `NanumSquare AC` and `Pretendard` by font name but does not embed font files. Font substitution on a recipient machine may change text metrics.

## Shared business catalog UX contract

- `DESIGN.md` is the source of truth for authoring UI and catalog UX decisions; generated mockups are non-binding until explicitly approved.
- Keep one product screen with `로드맵 편집` and `사업 카탈로그` working modes. Show one mode at a time.
- Catalog mode opens on the saved-program list. `로드맵에 추가` is primary; `새 사업 등록` is secondary; master edit/delete are subordinate.
- Do not use a modal, drawer, separate route, or permanently expanded catalog below the roadmap.
- Selecting a master creates an independent roadmap copy. Later edits or deletion of either record must not mutate the other.
- Catalog controls and status must never appear in print or alter the A4 output contract.
- MVP catalog writes are shared and unauthenticated by explicit product decision. Keep API validation and visible failure handling; defer login, roles, approval, moderation, and feedback.

## Annual catalog verification contract

- A staff member may toggle `올해 확인` only after confirming by phone that the catalog program continues this year. This records continuation only; schedule and details may still be unknown.
- Store a nullable verification year on the catalog master and compare it with the current `Asia/Seoul` year. Do not add a reset job; a prior-year value simply renders as unconfirmed.
- Render annual verification as one compact circular icon-only toggle in each catalog row: outlined and empty when unconfirmed, filled green with a check when confirmed. Keep visible status wording out of the row while preserving an accessible label and hover title.
- Keep the marker informational and reversible. It must not warn, block, hide, filter, sort, reorder, or alter roadmap selection.
- Do not copy verification into roadmap programs or expose it in PDF/PPTX output. Do not add identity, evidence, history, authentication, or approval workflow without a new explicit product decision.

## Automatic roadmap matching contract

- Treat industry and region matches as scoring signals instead of hard eligibility filters. Keep only explicit women-only and inferred tenure mismatches as hard exclusions.
- Rank recommendation candidates by total match score descending, then use main-package status, exact-match count, amount, ID, and title as deterministic tie-breakers.
- Recognize an administrative locality as matching a program tagged with its parent province, below an exact locality match and above a nationwide match.
- Return up to 35 authoring-only recommendation candidates: at least 20 business and 10 voucher candidates when enough eligible records exist, no more than 5 IP candidates, and no certification candidates. Fill unused IP capacity with additional business or voucher candidates.
- Preserve the fixed A4 roadmap row ceilings. Auto-place only the highest-ranked candidates that fit those rows and expose the remaining recommendations, scores, and scoring reasons in the authoring UI for manual replacement.

## Government support-program ingestion contract

- This is the binding policy for the next full catalog ingestion. Do not treat the prior 10-minute crawl as a resumable production run; restart from row 1 after re-filtering the source workbook.
- Preserve the standing source filters: exclude 2024 notices and support fields `인력` and `경영`.
- Reserve `컨설팅` for roadmap content written directly by the author; never ingest a government support notice into the shared catalog as `consulting`. Classify notices as `business` by default, and use `voucher` only when the benefit is delivered through an explicit voucher, credit, point, coupon, or equivalent service-use allowance.
- Apply the same exclusion to the live catalog and every future ingestion: remove programs that directly provide financial guarantees or guarantee-fee support, and programs that directly support hiring, employment, new-job creation, employee wages, or employment-linked certification.
- Do not exclude a program solely because it mentions generic project labor costs, outsourced interpreters or service staff, workforce training, an existing-headcount eligibility rule, `무보증` grant terms, patent assurance, or a Credit Guarantee Fund investment review; exclude it only when the program itself provides guarantee or hiring/employment support.
- Before crawling details, re-filter the previously reviewed workbook in its existing row order. Exclude any record whose normalized title contains `보증`, `연장`, `추가모집`, `주관기관모집`, `융자`, or `통합공고`; normalize by removing whitespace so spaced variants are excluded too. `주관기관 모집` targets organizers rather than participating/demand companies, `융자` is out of scope like guarantees, and `통합공고` combines multiple support programs.
- Exclude any record whose whitespace-normalized support-program title or `지원내용` contains `육성자금` or `운전자금`. Apply this rule to review datasets, the live catalog, and every future write or ingestion.
- Normalize every support period to `YY.MM ~ YY.MM`. Even a single-month period repeats the same month on both sides.
- Rewrite `지원대상` as one concise sentence without dropping eligibility restrictions that affect who may apply.
- Keep `지원내용` as one concise sentence when it describes one benefit. When it contains multiple benefits, use separate `- ` bullet lines within the cell or field.
- Record `지원금액` as the single largest explicitly stated monetary amount. Keep only the amount and unit; remove qualifiers such as `최대`, `기업당`, `건당`, and `이내`.
- Resolve an initially unknown amount by checking the structured amount field, notice body, downloaded attachments, and extracted support details, then selecting the largest explicit monetary value found. Never infer an unstated amount; if no source contains a monetary value, keep `불명` and flag it for review.
- Assign exactly one upper-industry tag based on the title, target, and support details: `AI·디지털`, `바이오·헬스케어`, `제조·소부장`, `모빌리티·로봇`, `에너지·환경`, `콘텐츠·관광`, `유통·소비재`, `농림·수산·해양`, `금융·비즈니스서비스`, `건설·공간`, `국방·우주`, or `교육·사회서비스`. Do not create new industry tags.
- Assign every explicitly restricted region tag found in the eligibility conditions. If the program has no regional restriction, assign the `전국` tag.
- Apply these transformations to the review dataset first. Do not write to the production catalog until the filtered and normalized result has been reviewed.
