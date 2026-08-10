# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-08-10
- Primary product surfaces: shared saved-roadmap library, desktop roadmap authoring, shared support-program catalog, A4 landscape roadmap preview, PDF print output, and native editable PPTX export
- Evidence reviewed: `AGENTS.md`, `src/App.jsx`, `src/styles.css`, `src/roadmap-policy.js`, `src/pdf-preflight.js`, `public/assets/anp-consulting-logo.png`, the running 1440x1024 authoring screen, `.omx/specs/deep-interview-business-registration.md`, `.omx/specs/deep-interview-roadmap-saving.md`, `.omx/specs/deep-interview-roadmap-bar-feedback.md`, the user-approved inline-composer/right-inspector mock, `업종별_지역별_개별속성_중복제거.xlsx`
- Governance: this file defines product and UI/UX policy. Generated mockups are exploratory until the user explicitly approves one; they do not override this file.

## Brand

- Personality: precise, calm, practical, trustworthy, and consulting-oriented
- Trust signals: restrained hierarchy, explicit validation state, predictable actions, readable Korean labels, and unchanged print output
- Avoid: decorative dashboards, marketing-style gradients, glass effects, excessive cards/badges, playful motion, hidden destructive actions, or UI inside the printable canvas

## Product goals

- Goals:
  - Let visitors open, create, explicitly save, and permanently delete shared roadmap drafts.
  - Let users reuse a centrally managed catalog of support programs.
  - Make selecting a catalog program faster than retyping a roadmap row.
  - Keep catalog masters independent from client-specific roadmap copies.
  - Keep the existing roadmap validation, preview, and PDF workflow intact while offering a parallel native editable PPTX download.
  - Let a team lead attach a modification request to an exact roadmap bar and track it through assignee completion to team-lead resolution.
- Non-goals:
  - Personal accounts, named attribution, per-person permissions, or a general approval/moderation platform.
  - Replies, mentions, attachments, notifications, comment editing/deletion, priority, due dates, or real-time collaboration.
  - Automatic notice crawling or metadata extraction.
  - Site-wide navigation redesign or a new multi-page information architecture.
  - Redesigning the A4 landscape document.
  - Treating exploratory generated images as implementation requirements.
  - Autosave, ownership, history, duplication, trash, search, or sorting controls for saved roadmaps.
- Success signals:
  - Users can find a saved program, add it to the roadmap, and see the independent copy with minimal context switching.
  - A growing catalog remains usable without a long combined page, modal, or drawer.
  - Catalog failures never erase or block an already-open roadmap.
  - Existing build, policy, preflight, render, and Sites handoff tests remain green.

## Personas and jobs

- Primary personas: internal ANP consultants or advisors preparing annual client roadmaps; this is inferred from the existing product copy and workflow.
- User jobs:
  - Maintain reusable support-program information.
  - Select relevant programs for a client.
  - Adjust copied amounts and periods for that client without changing the shared master.
  - Validate and print a one-page roadmap.
  - Request a specific roadmap change, mark the change complete, and confirm whether it is resolved.
- Key contexts of use: desktop browser, data-dense authoring, repeated use across multiple client roadmaps, shared catalog visible across devices.

## Information architecture

- Primary navigation: the initial saved-roadmap library leads to the existing editor; no client-side router is required.
- Core screens:
  - `저장된 로드맵`: shared roadmap list, create, open, and permanent delete.
  - Editor: the existing roadmap/catalog working modes plus explicit roadmap save and return-to-list actions.
- Working modes:
  - `로드맵 편집`: client name, selected program rows, validation, A4 preview, PDF print, and native editable PPTX download.
  - `사업 카탈로그`: shared master list, master CRUD, and copy-to-roadmap action.
- Roadmap feedback stays inside `로드맵 편집`: selecting a bar either opens the zero-feedback quick composer beside it or opens the existing thread in the right inspector.
- Content hierarchy in catalog mode:
  1. Working-mode controls.
  2. Saved-program list and its primary selection actions.
  3. `새 사업 등록` as a secondary action.
  4. Master edit/delete as subordinate actions.
  5. Concise load, empty, success, and error feedback.
- Catalog containment: use the full authoring width and show one working mode at a time. Do not use a modal, drawer, separate page, or permanently expanded catalog below the roadmap.

## Design principles

- Preserve the document contract: catalog UI belongs to the authoring surface and must never appear in print.
- Protect unsaved work: warn before leaving the editor when the in-memory document differs from the last successful save.
- Optimize the repeated job: the saved list is the default; `로드맵에 추가` is the primary catalog action.
- Scale by disclosure: keep long lists compact and reveal extended descriptions only when needed.
- Make data boundaries visible: distinguish `사업 카탈로그` masters from `로드맵 사업` copies in labels and feedback.
- Prefer boring, native interaction patterns: buttons, inputs, lists/tables, row separators, and inline feedback before custom widgets.
- Tradeoff: MVP public editing favors speed over protection. Do not disguise the absence of authentication as security.
- Minimize feedback chrome: show a small screen-only feedback affordance on the bar, then reveal only the active thread and its next valid action.

## Visual language

- Color: reuse the existing cool-gray page, white working surfaces, dark navy primary actions, muted text, green success, orange validation warning, and restrained red destructive action.
- Typography: reuse the current Korean fonts and hierarchy; readable authoring text is 14-16px, while the print canvas retains its separate fixed typography contract.
- Spacing/layout rhythm: align to the existing wide centered authoring surface; use compact vertical rhythm for data rows and generous separation between toolbar, modes, feedback, and content.
- Shape/radius/elevation: reuse the current modest radii and light surface shadow; prefer row dividers over card-per-record styling.
- Motion: only brief, non-essential state transitions; no motion in print and no motion required to understand success or error.
- Imagery/iconography: use the AIO Roadmap Studio icon in non-print product chrome; preserve the ANP logo only inside the printable client document. Text labels remain mandatory for primary and destructive actions.

## Components

- Existing components to reuse:
  - Top toolbar and print action.
  - Client-name field and program-row editor patterns.
  - Policy/preflight error presentation.
  - A4 preview and print-only styling.
- New/changed components:
  - `SavedRoadmapLibrary` reusing the existing list, notice, and action styles.
  - `WorkspaceModeSwitch` for `로드맵 편집` / `사업 카탈로그`.
  - `CatalogToolbar` with keyword, category, industry, and region filters plus the secondary `새 사업 등록` action.
  - `CatalogList` and `CatalogRow` using lightweight row separation.
  - `CatalogForm` for explicit create/edit mode, not the catalog default.
  - New-business `CatalogForm` is text-first: one agreed-format textarea, inline source-text errors, then searchable multi-select industry and region tags. A missing industry or region can be added as an immediately persisted public option from its picker. It parses only on registration and never shows a parsed-result review or individual creation fields.
  - Existing-business editing retains the current individual editable fields and tag selectors.
  - Inline catalog status feedback with a route back to roadmap editing.
  - `RoadmapFeedbackComposer` anchored beside a selected bar only when that program has no feedback.
  - `RoadmapFeedbackInspector` for an existing thread, with program title, state, flat timeline, team-lead authentication when needed, and current-state actions.
- Variants and states:
  - Mode switch: active and inactive.
  - Catalog row: default, focused, expanded if needed, submitting, and mutation error.
  - Add action: ready, submitting, added, and disabled for invalid records.
  - Form: create and edit, sharing the same field policy.
  - Feedback: none/quick composer, `수정 필요`, `수정 완료`, `해결`, loading, retryable error, unauthenticated lead action, and authenticated lead action.
- Token/component ownership: extend existing CSS classes and variables; do not introduce a design-system layer or dependency for this feature.

## Accessibility

- Target standard: WCAG 2.1 AA for the authoring interface.
- Keyboard/focus behavior:
  - Opening either screen moves focus to its heading.
  - Mode controls, search, row actions, forms, and retry actions must be keyboard reachable.
  - Switching modes moves focus to the new mode heading or first meaningful control.
  - Focus must remain visible and must not enter hidden-mode content.
- Contrast/readability: preserve readable contrast for navy, green, orange, and red states; never rely on color alone.
- Screen-reader semantics:
  - Mode controls expose the current selection.
  - Catalog status updates use an appropriate live region.
  - Edit/delete labels include the program title.
  - Field errors are connected to their controls.
- Reduced motion and sensory considerations: respect reduced-motion preferences; all state changes remain understandable without animation.

## Responsive behavior

- Supported breakpoints/devices: desktop authoring is primary. The catalog remains usable at tablet/laptop widths; the fixed A4 preview may scroll horizontally outside print.
- Layout adaptations:
  - Wide screens use aligned table/list columns.
  - Narrow authoring widths stack secondary metadata beneath the program title and keep the primary add action visible.
  - Do not convert the catalog into a modal or drawer at narrow widths.
  - The feedback inspector slides from the right on desktop and becomes a full-width lower panel on narrow screens. The quick composer remains anchored to the selected bar without changing printable geometry.
- Touch/hover differences: all actions have visible labels or accessible names and touch-safe targets; hover is supplementary.

## Interaction states

- Loading: show a compact catalog loading state only inside catalog mode; keep the active roadmap state intact.
- Saved-roadmap loading/errors remain in the library; failed open/save/delete operations must not discard the in-memory document.
- Empty: explain that no saved programs exist and offer `새 사업 등록`.
- Error: preserve the last usable catalog data when possible, explain the failed operation, and offer a focused retry.
- Success: confirm the named program was added and offer `로드맵 편집으로 이동`.
- Disabled: state why an action is unavailable; do not use disabled styling as the only explanation.
- PPTX export: disable only for canonical document/layout errors or while generation is running; show a named success message or an explicit generation error inline. Chromium/PDF-runtime-only failures must not disable PPTX export.
- Offline/slow network: do not claim a shared write succeeded until the server confirms it; the roadmap remains locally usable during catalog failure.
- Feedback failure: keep the active roadmap and last usable feedback timeline intact, show a focused retry, and never imply a state transition succeeded before server confirmation.
- Unsaved roadmap feedback: explain that the roadmap must be explicitly saved before feedback can be persisted; do not silently autosave.
- New-business parse errors: keep the source text and tag selections in place, show actionable feedback immediately below the textarea, and do not issue a create request until the source format is valid.
- New industry/region options: persist when the inline add action succeeds, independently of later business registration. Keep a successful option after registration cancellation or failure; on option failure, preserve the source text and existing selections.

## Content voice

- Tone: concise, direct, operational, and non-promotional.
- Terminology:
  - Shared master: `사업 카탈로그` or `등록된 사업`.
  - Client copy: `로드맵 사업`.
  - Primary action: `로드맵에 추가`.
  - Secondary creation action: `새 사업 등록`.
- Microcopy rules: name the affected program in success, error, edit, and delete messages. Avoid ambiguous `저장` when the action is add, edit, or copy.

## Implementation constraints

- Framework/styling system: React 19, Vite, and the existing plain CSS architecture.
- Design-token constraints: reuse existing colors, fonts, spacing, radii, and print rules before adding values.
- Performance constraints: long catalogs require bounded rendering/pagination or an equally simple server query; apply active keyword, category, industry, and region filters before pagination and do not load unbounded rich detail into every visible row.
- Compatibility constraints:
  - Preserve `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` contracts.
  - Use the existing Sites D1 capability through a logical `DB` binding for central structured persistence. Sites owns the deployed database resource and binding.
  - Route catalog requests through the existing Worker before its unchanged static-asset and app-shell fallback behavior.
  - Public shared writes still require API-boundary validation and safe failure handling.
  - Keep shared team-lead password verification, retry limits, and sessions in the Worker/D1 boundary. Browser code receives only authenticated session state and never the password verifier or session record.
- Test/screenshot expectations:
  - Add focused behavior checks for mode switching, catalog load/CRUD, copy-on-select, and master/copy independence.
  - Keep the existing roadmap policy, PDF preflight, render-contract, build, and Sites tests passing.
  - Inspect generated PPTX package structure and rendered slide output. Require one A4 landscape slide, editable native text/shapes/lines, stable `.text`/`.amount`/`.bar` program object names, ANP-only output branding, and no full-slide screenshot. Compare a rendered amount label against the approved PDF and keep its horizontal and vertical origin within 2px at 1754 x 1240px.
  - Verify at least one populated, empty, loading, mutation-error, and success state.

## Catalog data and API policy

- Storage: one D1 table for catalog masters. Do not add browser storage, an external data service, an ORM, or a generic repository layer.
- API surface:
  - `GET /api/catalog-programs?q=&category=&industry=&region=&limit=&offset=` returns a bounded filtered page and total count. Repeated industry values use OR, repeated region values use OR, and active dimensions combine with AND.
  - `POST /api/catalog-programs` creates a master.
  - `PUT /api/catalog-programs/:id` replaces the editable master fields.
  - `DELETE /api/catalog-programs/:id` deletes only the master.
  - `GET /api/catalog-options` returns shared industry and region choices.
  - `POST /api/catalog-options` immediately creates one shared industry or region choice.
- Pagination: default 50 records, maximum 100, newest updates first, with simple previous/next controls. This is sufficient for the expected MVP catalog size; replace offset pagination only if measured scale makes it necessary.
- Validation boundary: accept only the agreed fields; require a known roadmap category, non-empty title/target/details, an `http` or `https` link, a null amount or safe integer KRW amount of at least 1,000,000, and inclusive months from 1 through 12 with start not after end. Industry and region are optional arrays containing only shared workbook-derived or dynamically created values; both allow multiple selections. Trim new values, bound their length, and prevent exact duplicates at the API/database boundary.
- Tag storage/filtering: store industry and region selections as JSON arrays on each catalog master. Filter the complete catalog server-side before pagination, using OR within each tag dimension and AND across active dimensions. Keep the workbook-derived arrays as the initial shared choices and persist only newly added values in D1.
- Identity: generate a new catalog ID on create and a different new roadmap-program ID on copy. Never store a live master reference in the roadmap copy.
- Concurrency: use normal request-level last-write-wins semantics for this unauthenticated MVP. Return explicit not-found, validation, and server errors; do not add conflict-resolution UI.
- Initialization: keep the schema and one idempotent KIMST/SCCEI seed migration in the repository. Do not create production resources or credentials from application code.
- Failure isolation: failed catalog reads or writes must leave the current in-memory roadmap document untouched.

## Saved roadmap data and API policy

- Storage: one D1 `roadmaps` table stores the full roadmap document as JSON plus list metadata. Do not add browser storage or another persistence service.
- API surface: bounded `GET /api/roadmaps`, plus `POST /api/roadmaps`, and `GET`/`PUT`/`DELETE /api/roadmaps/:id`.
- Draft semantics: structural validation and size limits apply at the API boundary, but incomplete titles or invalid PDF periods may still be saved. Existing PDF preflight remains the output gate.
- Access/concurrency: all visitors can read, update, and permanently delete; last write wins. Show this risk in the library and revisit authentication before production exposure.
- Save semantics: new roadmaps exist only in memory until the user chooses `로드맵 저장`; no autosave.

## Roadmap feedback data and API policy

- Storage: keep one thread per saved roadmap/program pair and a chronological event list in D1. Feedback is not part of `document_json`.
- State machine: initial team-lead feedback creates `수정 필요`; the public assignee/editor may transition it to `수정 완료`; an authenticated team lead may transition it to `해결` or back to `수정 필요` with a required rework message.
- Authentication: use one shared team-lead password verifier stored as a server secret, a short-lived HttpOnly/Secure/SameSite session, and D1-backed server throttling. No personal account or named actor record is created.
- API boundary: list feedback by saved roadmap; create initial feedback for a stable program ID; transition one program thread with the allowed action. Validate roadmap/program existence, request shape, text length, current state, team-lead session where required, and JSON content type.
- Deletion: roadmap deletion removes its feedback; a program removed from a saved roadmap must not leave user-visible orphaned feedback.
- Export isolation: the inspector, quick composer, unresolved marker, selection outline, and state indicators are screen-only and excluded from print, PDF, and PPTX. Roadmap bars never show a feedback or comment count.

## Open questions

- [x] Central persistence/API: Sites D1 with logical `DB` binding and Worker-owned catalog routes.
- [x] MVP long-list scaling: server-bounded offset pagination, 50 by default and 100 maximum.
- [x] Roadmap feedback MVP: shared team-lead password, no personal accounts, authoring-only quick composer and responsive inspector.
- [ ] Revisit personal authentication, individual revocation/attribution, and broader moderation before production exposure / product owner / accepted shared-credential risk.
