# Design QA

## 승인 기준과 산출물

- 기준 이미지: `design-reference-proportions.png`
- 검증 PDF: `output/pdf/ANP-roadmap-verified.pdf`
- 150dpi PDF 렌더: `output/preview/ANP-roadmap-verified.png`
- 좌우 비교본: `output/design-qa-comparison-verified.png`
- 자동 QA 보고서: `output/pdf/ANP-roadmap-verified.qa.json`
- 검증 PPTX: `output/pptx/ANP-roadmap-verified.pptx`
- PPTX 렌더: `output/pptx/rendered/slide-1.png`
- PPTX 자동 QA 보고서: `output/pptx/ANP-roadmap-verified.qa.json`

## 관리형 출력 환경

- Chromium family: Google Chrome 150.0.7871.187
- 표준 프로필: A4, 가로, 배율 100%, 여백 없음, 배경 그래픽 켬, 머리글/바닥글 끔
- PDF: 1페이지, 841.91998 x 594.95996pt (A4 landscape)
- PDF 렌더: 1754 x 1240px, 150dpi
- 사전검증: `ready`, blocking 오류 0건, console warning/error 0건
- 편집 UI(`.no-print`) PDF 유출: 0건

## 실측 디자인 계약

| 항목 | 확정값 | 실측 |
| --- | ---: | ---: |
| 브라우저 A4 캔버스 | 297 x 210mm | 1122.5126 x 793.7000px |
| 자간 | 0 | PDF 캔버스 상속 규칙 `letter-spacing: 0` |
| 라벨-막대 간격 | 약 2pt | 1.9969pt |
| 라벨 왼쪽 오프셋 | 0.5pt | 0.4969pt |
| 금액 위치 | `top: -8pt` | -10.6667px (-8pt) |
| 막대 높이 | 0.21cm | 0.20968cm |
| 시각 충돌 | 0 | 0 |
| 시트 경계 이탈 | 0 | 0 |
| 시트 스크롤 초과 | 0 | 0 |

## 폰트와 자산

- 내장 폰트: NanumSquare AC Regular, Bold, ExtraBold; Pretendard Regular
- 워터마크: Arial Bold
- 로고: 제공된 `anp-consulting-logo.png`, 브라우저 naturalWidth 162
- 색상: 컨설팅 `#BFBFBF`, 사업화 `#5B9BD5`, 바우처 `#FFC000`, IP `#F86828`, 기업인증 `#70AD47`

## 시각 판정

- 기준 이미지와 검증 PDF의 표 좌우 여백, 표 상·하단 위치, 카테고리 높이, 헤더/안내문/푸터 비율이 동일한 구성으로 유지된다.
- ANP 로고는 기준 이미지의 ALPHA&PARTNERS 워드마크와 종횡비가 다르며, 사용자가 승인한 동일 위치·유사 크기 규칙을 따른다.
- 문구, 금액, 막대, 워터마크, 안내문, 푸터에 잘림·겹침·누락 글리프·색상 손실이 없다.
- P0/P1/P2 이슈: 0건.

## 네이티브 편집형 PPTX 판정

- 파일 구조: A4 landscape 297 x 210mm, 정확히 1슬라이드, 141,878 bytes.
- 네이티브 개체: 도형 131개, 텍스트 개체 72개, 선 25개, 프로그램 텍스트 28개, 독립 금액 텍스트 20개, 프로그램 둥근 막대 28개, 독립 ANP 로고 이미지 1개.
- 안정적 매핑: 모든 프로그램에 `anp.roadmap.program.{id}.text`와 `anp.roadmap.program.{id}.bar` 개체명이 존재하고, 금액이 있는 20개 프로그램에는 `anp.roadmap.program.{id}.amount`가 존재한다.
- 평면화 방지: 전체 슬라이드 이미지가 없고, 유일한 이미지 개체는 전체 캔버스의 절반보다 작은 ANP 로고다.
- 출력 경계: `slides_test.py` 렌더 패딩 검사에서 캔버스 오버플로 0건.
- PDF 대비 1754 x 1240px 렌더 기준: 대표 금액 `1억원`의 원본 좌표는 `(320, 418)`, PPTX 좌표는 `(321, 419)`로 가로·세로 각 1px 차이다. 제목 상단 경계 차이 3px, 표 상단 차이 1px이며, 월/카테고리 그리드, 프로그램 행·막대, 안내문, 푸터에 잘림·겹침이 없다.
- 금액 배치: PptxGenJS의 자동 위첨자를 사용하지 않고 제목과 독립된 네이티브 텍스트 상자로 생성한다. 브라우저에서는 로드된 `NanumSquare AC`의 실제 제목 폭을 측정하고, 비브라우저 검증 경로에서는 동일 규칙의 결정적 폭 추정값을 사용한다.
- 브라우저 다운로드 스모크: Chrome 151.0.7922.108에서 승인 웹폰트가 로드된 샘플 로드맵으로 `.pptx` 다운로드, 안전한 고객명 파일명, OOXML ZIP 시그니처를 확인했다. 해당 브라우저 산출물을 다시 렌더했을 때도 대표 금액 좌표는 PDF 대비 가로·세로 각 1px 차이였고 오버플로는 0건이었다.
- 글꼴: `NanumSquare AC`, `Pretendard`, `Arial` 이름을 참조한다. PPTX에 글꼴 파일은 임베딩되지 않으므로 수신 환경에 글꼴이 없으면 PowerPoint의 대체 글꼴로 텍스트 폭이 달라질 수 있다.
- AIO Roadmap Studio 브랜딩·툴바·저장/카탈로그/PDF/PPTX 컨트롤 유출: 0건.

## PPTX 의존성 보안 판정

- `npm audit`는 `pptxgenjs@4.0.1`이 선언한 `image-size@1.2.1`에 대해 ICNS/JXL/HEIF 무한 루프 DoS 고위험 권고 2건을 보고한다. 2026-08-10 기준 `image-size@2.0.2`까지 영향을 받아 패치 버전이 없다.
- 현재 경로에서는 도달 불가능한 설치 전이 의존성으로 수용한다. PptxGenJS의 `browser` 매핑은 `image-size: false`이고 ESM 배포본과 Vite 생산 번들에 활성 import/reference가 없다.
- 앱은 외부 업로드 이미지를 처리하지 않고, 저장소의 ANP PNG를 data URI로 읽어 명시적인 `x/y/w/h`와 함께 추가하므로 이미지 크기 추론 파서를 호출하지 않는다.
- 임의 버전 override는 보안 수정으로 간주하지 않는다. 업스트림이 패치된 릴리스를 제공하면 정확한 버전을 재평가하고, 조직 정책이 audit 0건을 강제하면 미사용 의존성을 제거한 MIT 라이선스 내부 fork를 별도 검토한다.

## 회귀 검증

- `npm.cmd test`: passed
- `npm.cmd run test:sites`: passed
- `npm.cmd run build`: passed
- `npm.cmd run verify:pdf`: 기존 Chrome 150 검증 산출물은 passed 상태로 보존. 2026-08-10 재실행은 앱을 열기 전에 설치 브라우저가 151.0.7922.108로 자동 업데이트되어 150 고정 계약 검사에서 중단됨; 설치된 Chrome 150 사본 없음.
- `npm.cmd run verify:pptx`: passed
- PPTX 전체 슬라이드 렌더 및 오버플로 검사: passed
- 관리형 Chrome 150 브라우저 다운로드 스모크와 현재 설치 Chrome 151 글꼴폭 측정·다운로드 스모크: passed

historical export QA result: passed

## Roadmap feedback UI QA (2026-08-10)

- Approved reference: `C:\Users\111-02-2306-06\.codex\generated_images\019fea4f-9a0d-7402-af22-f18e938e9698\exec-8c7bd81c-e282-4f35-926c-afdb41274814.png`
- Intended checks: zero-feedback inline composer beside a bar, existing-thread desktop inspector, and the narrow full-width lower panel.
- Contract deviations from the exploratory reference: feedback/comment counts are intentionally omitted; only an unresolved screen-only marker is allowed.
- Local preview: `http://127.0.0.1:4173/` was started with fixture data. Browser QA captured and checked the empty-bar inline composer, the completed-thread desktop inspector, and the 820px-wide lower-panel inspector. Their visible DOM states, placement, and primary controls matched the approved interaction model; the no-count deviation is intentional and binding. The console had no warning or error entries.
- Automated evidence: `npm.cmd run test` (59 passed), `npm.cmd run build` (passed), `npm.cmd run test:sites` (9 passed), and `npm.cmd run verify:pptx` (passed).
- Separate export limitation: PDF verification is blocked before rendering because managed Chrome 151.0.7922.108 does not meet the repository-pinned major 150 policy.

## Wanted-style catalog filter QA (2026-08-12)

- Source of truth: `.omx/audits/wanted-filter-reference-20260812/01-default-filter-bar.png` (Wanted default filter bar, 1521 x 688px).
- Implementation capture: `.omx/audits/wanted-filter-implementation-20260812/01-desktop-filter-bar.png` (AIO catalog default filter state, 1521 x 688px).
- Responsive captures: `.omx/audits/wanted-filter-implementation-20260812/02-mobile-filter-bar.png` and `03-mobile-region-popover.png`, captured with a 390 x 844 browser viewport override.
- Compared state: saved Premium roadmap → `사업 카탈로그` → `구분=사업화`, no active tags, full `1–12월` period, blank business-name query, populated catalog results.
- Full comparison: the reference and implementation desktop captures were inspected together at the same dimensions. The implementation preserves the existing AIO chrome and tokens while matching the reference interaction grammar: one compact horizontal filter surface, visible selected state, quick chips, and overlay option surfaces.
- Focused comparison: category and region overlays were opened on desktop and mobile. Both remain in the top layer, use a dimmed backdrop, fit within the viewport, and do not change document height.
- Interaction evidence: category selection applies and closes its overlay; industry and region selections update the closed-control summary; Escape dismisses overlays; business-subcategory chips update results immediately; the month inputs remain keyboard operable and clamp at `12–12월`; target/details-only search text does not match while a title substring does.
- Responsive/accessibility evidence: desktop and 390px layouts have no horizontal document overflow; labels, fieldsets, pressed states, dialog roles, slider names/value text, visible focus, and practical touch targets are present.
- Iteration history: pass 1 found that the category dialog remained open after selection because the app's `document` state shadows the browser global. Replaced that imperative close with the native `popoverTargetAction="hide"` contract. Pass 2 verified the dialog closes and the new result set renders without new console errors.
- P0/P1/P2 findings after pass 2: 0.

final result: passed
