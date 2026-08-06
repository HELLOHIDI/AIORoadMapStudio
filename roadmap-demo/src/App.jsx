import { useEffect, useMemo, useRef, useState } from "react";
import { INDUSTRY_OPTIONS, REGION_OPTIONS } from "../catalog-options.js";
import { formatAmount } from "./amount.js";
import { catalogPayload, copyCatalogProgram, EMPTY_CATALOG_PROGRAM, parseCatalogText } from "./catalog.js";
import { runPdfPreflight } from "./pdf-preflight.js";
import { detectPdfRuntime, PDF_RUNTIME } from "./pdf-runtime.js";
import { buildRoadmapLayout, moveProgramToLane, ROADMAP_CATEGORIES } from "./roadmap-policy.js";
import { sampleRoadmap } from "./sample-roadmap.js";

const months = Array.from({ length: 12 }, (_, index) => `${index + 1}월`);
const categoryLabel = Object.fromEntries(ROADMAP_CATEGORIES.map(({ key, label }) => [key, label]));

async function readApiJson(response) {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("사업 카탈로그 서버 응답 형식이 올바르지 않습니다.");
  }
  try {
    return await response.json();
  } catch {
    throw new Error("사업 카탈로그 서버 응답을 읽지 못했습니다.");
  }
}

function RoadmapEvent({ item, dragging, onDragStart, onDragEnd, onMove }) {
  const moveByKeyboard = (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    onMove(item.id, item.rowIndex + (event.key === "ArrowUp" ? -1 : 1));
  };

  return (
    <div
      className={`roadmap-event roadmap-event--${item.category}${dragging ? " roadmap-event--dragging" : ""}`}
      data-program-id={item.id}
      style={{ "--start": item.startOffset, "--span": item.span }}
      draggable
      role="button"
      tabIndex="0"
      aria-label={`${item.title}, ${categoryLabel[item.category]}. 위아래 화살표 키로 행 이동`}
      onDragStart={(event) => onDragStart(event, item.id)}
      onDragEnd={onDragEnd}
      onKeyDown={moveByKeyboard}
    >
      <div className="roadmap-event__copy">
        <span className="roadmap-event__handle no-print" aria-hidden="true">↕</span>
        <span>{`[${categoryLabel[item.category]}] ${item.title}`}</span>
        {item.amountKrw != null ? <sup>{formatAmount(item.amountKrw)}</sup> : null}
      </div>
      <div className="roadmap-event__bar" />
    </div>
  );
}

function ProgramEditor({ program, onChange, onDelete }) {
  const number = (value) => value === "" ? "" : Number(value);
  return (
    <div className="program-row">
      <select aria-label="구분" value={program.category} onChange={(event) => onChange({ category: event.target.value })}>
        {ROADMAP_CATEGORIES.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
      </select>
      <input aria-label="사업명" value={program.title} onChange={(event) => onChange({ title: event.target.value })} placeholder="사업명" />
      <input aria-label="시작월" type="number" min="1" max="12" value={program.startMonth} onChange={(event) => onChange({ startMonth: number(event.target.value) })} />
      <input aria-label="종료월" type="number" min="1" max="12" value={program.endMonth} onChange={(event) => onChange({ endMonth: number(event.target.value) })} />
      <input aria-label="금액" type="number" min="1000000" step="1000000" value={program.amountKrw ?? ""} onChange={(event) => onChange({ amountKrw: event.target.value === "" ? null : Number(event.target.value) })} placeholder="금액(원)" />
      <button type="button" className="delete-program" onClick={onDelete} aria-label={`${program.title || "새 사업"} 삭제`}>×</button>
    </div>
  );
}

function FieldError({ errors, name }) {
  return errors?.[name] ? <small className="field-error">{errors[name]}</small> : null;
}

function TagPicker({ label, options, value = [], onChange }) {
  const [query, setQuery] = useState("");
  const selected = Array.isArray(value) ? value : [];
  const filtered = options.filter((option) => option.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const toggle = (option) => onChange(selected.includes(option)
    ? selected.filter((item) => item !== option)
    : [...selected, option]);

  return (
    <fieldset className="tag-picker">
      <legend>{label} <small>복수 선택</small></legend>
      {selected.length ? (
        <div className="tag-picker__selected" aria-label={`선택한 ${label}`}>
          {selected.map((option) => (
            <button type="button" key={option} onClick={() => toggle(option)} aria-label={`${option} 선택 해제`}>{option} ×</button>
          ))}
        </div>
      ) : <p className="tag-picker__empty">선택된 항목이 없습니다.</p>}
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`${label} 검색`} aria-label={`${label} 검색`} />
      <div className="tag-picker__options">
        {filtered.map((option) => (
          <label key={option}>
            <input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} />
            <span>{option}</span>
          </label>
        ))}
        {!filtered.length ? <p>검색 결과가 없습니다.</p> : null}
      </div>
    </fieldset>
  );
}

function CatalogForm({ form, state, onChange, onCancel, onSubmit }) {
  const [importText, setImportText] = useState("");
  const [importErrors, setImportErrors] = useState([]);
  const values = form.values;
  const change = (name, value) => onChange({ ...values, [name]: value });
  const invalid = (name) => Boolean(state.fields?.[name]);
  const submit = (event) => {
    if (form.mode === "edit") return onSubmit(event);
    const parsed = parseCatalogText(importText);
    if (parsed.warnings.length) {
      event.preventDefault();
      setImportErrors(parsed.warnings);
      return;
    }
    setImportErrors([]);
    onSubmit(event, { ...values, ...parsed.values });
  };

  return (
    <form className="catalog-form" onSubmit={submit}>
      <div className="catalog-form__heading">
        <div>
          <h3>{form.mode === "create" ? "새 사업 등록" : "등록 사업 편집"}</h3>
          <p>저장한 내용은 사이트의 모든 방문자에게 공유됩니다.</p>
        </div>
        <button type="button" className="button-secondary" onClick={onCancel}>목록으로</button>
      </div>

      {form.mode === "edit" && state.error ? <p className="catalog-notice catalog-notice--error" role="alert">{state.error}</p> : null}

      {form.mode === "create" ? (
        <section className="catalog-import" aria-labelledby="catalog-import-heading">
          <div>
            <h4 id="catalog-import-heading">정리된 사업 내용 붙여넣기</h4>
            <p>아래 형식으로 입력한 뒤 업종과 지역을 선택해 등록해 주세요.</p>
          </div>
          <textarea
            rows="10"
            value={importText}
            onChange={(event) => {
              setImportText(event.target.value);
              if (importErrors.length) setImportErrors([]);
            }}
            placeholder={'[사업화] 사업명\n- 링크: https://\n- 지원기간: 6~7월\n- 지원금액: 30백만원\n- 지원대상:\n- 지원내용:'}
            aria-label="정리된 사업 내용"
            aria-invalid={importErrors.length > 0 || Boolean(state.error)}
          />
          {importErrors.length || state.error ? (
            <div className="catalog-import__errors" role="alert">
              {importErrors.length ? <ul>{importErrors.map((error) => <li key={error}>{error}</li>)}</ul> : null}
              {state.error ? <p>{state.error}</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="catalog-tag-pickers">
        <TagPicker label="업종" options={INDUSTRY_OPTIONS} value={values.industries} onChange={(next) => change("industries", next)} />
        <TagPicker label="지역" options={REGION_OPTIONS} value={values.regions} onChange={(next) => change("regions", next)} />
      </div>
      <FieldError errors={state.fields} name="industries" />
      <FieldError errors={state.fields} name="regions" />

      {form.mode === "edit" ? <div className="catalog-form__grid">
        <label>
          <span>구분</span>
          <select value={values.category} onChange={(event) => change("category", event.target.value)} aria-invalid={invalid("category")}>
            {ROADMAP_CATEGORIES.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </select>
          <FieldError errors={state.fields} name="category" />
        </label>
        <label className="catalog-field--wide">
          <span>사업명</span>
          <input maxLength="240" value={values.title} onChange={(event) => change("title", event.target.value)} aria-invalid={invalid("title")} required />
          <FieldError errors={state.fields} name="title" />
        </label>
        <label className="catalog-field--wide">
          <span>링크</span>
          <input type="url" maxLength="2048" value={values.link} onChange={(event) => change("link", event.target.value)} aria-invalid={invalid("link")} placeholder="https://" required />
          <FieldError errors={state.fields} name="link" />
        </label>
        <label>
          <span>최대 지원금액(원)</span>
          <input type="number" min="1000000" step="1000000" value={values.amountKrw} onChange={(event) => change("amountKrw", event.target.value)} aria-invalid={invalid("amountKrw")} placeholder="미정이면 비워두기" />
          <FieldError errors={state.fields} name="amountKrw" />
        </label>
        <label>
          <span>시작월</span>
          <input type="number" min="1" max="12" value={values.startMonth} onChange={(event) => change("startMonth", event.target.value)} aria-invalid={invalid("startMonth")} required />
          <FieldError errors={state.fields} name="startMonth" />
        </label>
        <label>
          <span>종료월</span>
          <input type="number" min="1" max="12" value={values.endMonth} onChange={(event) => change("endMonth", event.target.value)} required />
        </label>
        <label className="catalog-field--full">
          <span>지원대상</span>
          <textarea maxLength="1000" rows="3" value={values.target} onChange={(event) => change("target", event.target.value)} aria-invalid={invalid("target")} required />
          <FieldError errors={state.fields} name="target" />
        </label>
        <label className="catalog-field--full">
          <span>지원내용</span>
          <textarea maxLength="4000" rows="5" value={values.details} onChange={(event) => change("details", event.target.value)} aria-invalid={invalid("details")} required />
          <FieldError errors={state.fields} name="details" />
        </label>
      </div> : null}

      <div className="catalog-form__actions">
        <button type="button" className="button-secondary" onClick={onCancel}>취소</button>
        <button type="submit" className="button-primary" disabled={state.status === "saving"}>
          {state.status === "saving" ? "저장 중" : form.mode === "create" ? "사업 등록" : "변경사항 저장"}
        </button>
      </div>
    </form>
  );
}

export function App() {
  const [document, setDocument] = useState(sampleRoadmap);
  const [pdfState, setPdfState] = useState({ status: "editing", errors: [] });
  const [mode, setMode] = useState("roadmap");
  const [catalog, setCatalog] = useState({ status: "idle", items: [], total: 0, limit: 50, offset: 0, error: "" });
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogOffset, setCatalogOffset] = useState(0);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [catalogForm, setCatalogForm] = useState(null);
  const [catalogMutation, setCatalogMutation] = useState({ status: "idle", error: "", fields: {} });
  const [catalogNotice, setCatalogNotice] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [activeCategory, setActiveCategory] = useState(ROADMAP_CATEGORIES[0].key);
  const [draggingProgramId, setDraggingProgramId] = useState(null);
  const [layoutNotice, setLayoutNotice] = useState("");
  const roadmapHeading = useRef(null);
  const catalogHeading = useRef(null);
  const moveFocus = useRef(false);
  const layout = useMemo(() => buildRoadmapLayout(document), [document]);
  const currentRuntime = useMemo(() => detectPdfRuntime(), []);

  useEffect(() => {
    let current = true;
    setPdfState({ status: "preflighting", errors: [] });
    runPdfPreflight({ roadmapDocument: document }).then((result) => {
      if (current) setPdfState({ status: result.ok ? "ready" : "blocked", errors: result.errors });
    });
    return () => { current = false; };
  }, [document]);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (mode === "roadmap" ? roadmapHeading : catalogHeading).current?.focus();
  }, [mode]);

  useEffect(() => {
    if (mode !== "catalog") return undefined;
    const controller = new AbortController();
    setCatalog((current) => ({ ...current, status: current.items.length ? "refreshing" : "loading", error: "" }));

    const params = new URLSearchParams({ limit: "50", offset: String(catalogOffset) });
    if (catalogQuery) params.set("q", catalogQuery);
    fetch(`/api/catalog-programs?${params}`, { signal: controller.signal, headers: { accept: "application/json" } })
      .then(async (response) => {
        const data = await readApiJson(response);
        if (!response.ok) throw new Error(data.error || "사업 목록을 불러오지 못했습니다.");
        return data;
      })
      .then((data) => setCatalog({ status: "ready", items: data.items, total: data.total, limit: data.limit, offset: data.offset, error: "" }))
      .catch((error) => {
        if (error.name !== "AbortError") setCatalog((current) => ({ ...current, status: "error", error: error.message }));
      });

    return () => controller.abort();
  }, [mode, catalogQuery, catalogOffset, catalogRefresh]);

  const switchMode = (nextMode) => {
    if (nextMode === mode) return;
    moveFocus.current = true;
    setMode(nextMode);
  };

  const updateProgram = (id, patch) => setDocument((current) => ({
    ...current,
    programs: current.programs.map((program) => {
      if (program.id !== id) return program;
      const next = { ...program, ...patch };
      if (patch.category && patch.category !== program.category) delete next.laneIndex;
      return next;
    }),
  }));

  const addProgram = () => setDocument((current) => {
    const nextSequence = current.programs.reduce((max, program) => Math.max(max, program.sequence), -1) + 1;
    return {
      ...current,
      programs: [...current.programs, {
        id: globalThis.crypto.randomUUID(), category: activeCategory, title: "", startMonth: 1, endMonth: 1, amountKrw: null, sequence: nextSequence,
      }],
    };
  });

  const addCatalogProgram = (program) => {
    setDocument((current) => {
      const nextSequence = current.programs.reduce((max, item) => Math.max(max, item.sequence), -1) + 1;
      return { ...current, programs: [...current.programs, copyCatalogProgram(program, nextSequence)] };
    });
    setCatalogNotice({ tone: "success", message: `“${program.title}”을 로드맵에 독립 복사본으로 추가했습니다.`, returnToRoadmap: true });
  };

  const deleteProgram = (id) => setDocument((current) => ({
    ...current,
    programs: current.programs.filter((program) => program.id !== id),
  }));

  const moveProgram = (programId, targetLaneIndex) => {
    const result = moveProgramToLane({ programs: document.programs, programId, targetLaneIndex });
    if (!result.ok) {
      setLayoutNotice("해당 행에는 배치할 수 없습니다.");
      return;
    }
    setDocument((current) => ({ ...current, programs: result.programs }));
    setLayoutNotice(result.outcome === "swapped" ? "겹치는 사업의 행을 교환했습니다." : "사업의 행을 이동했습니다.");
  };

  const startDrag = (event, programId) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", programId);
    setLayoutNotice("");
    setDraggingProgramId(programId);
  };

  const endDrag = () => setDraggingProgramId(null);

  const openCatalogForm = (program = null) => {
    setCatalogMutation({ status: "idle", error: "", fields: {} });
    setCatalogNotice(null);
    setCatalogForm(program ? {
      mode: "edit",
      id: program.id,
      values: { ...program, amountKrw: program.amountKrw ?? "" },
    } : { mode: "create", values: { ...EMPTY_CATALOG_PROGRAM } });
  };

  const saveCatalog = async (event, submittedValues = catalogForm.values) => {
    event.preventDefault();
    setCatalogMutation({ status: "saving", error: "", fields: {} });
    const editing = catalogForm.mode === "edit";
    try {
      const response = await fetch(editing ? `/api/catalog-programs/${catalogForm.id}` : "/api/catalog-programs", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(catalogPayload(submittedValues)),
      });
      const data = await readApiJson(response);
      if (!response.ok) {
        setCatalogMutation({ status: "error", error: data.error || "사업을 저장하지 못했습니다.", fields: data.fields || {} });
        return;
      }
      setCatalogForm(null);
      setCatalogMutation({ status: "idle", error: "", fields: {} });
      setCatalogNotice({ tone: "success", message: `“${data.item.title}”을 ${editing ? "수정" : "등록"}했습니다.` });
      if (!editing) {
        setCatalogSearch("");
        setCatalogQuery("");
        setCatalogOffset(0);
      }
      setCatalogRefresh((current) => current + 1);
    } catch (error) {
      setCatalogMutation({ status: "error", error: error.message || "네트워크 연결을 확인하고 다시 시도해 주세요.", fields: {} });
    }
  };

  const deleteCatalogProgram = async (program) => {
    if (!window.confirm(`“${program.title}”을 사업 카탈로그에서 삭제할까요? 기존 로드맵 복사본은 유지됩니다.`)) return;
    setDeletingId(program.id);
    setCatalogNotice(null);
    try {
      const response = await fetch(`/api/catalog-programs/${program.id}`, { method: "DELETE", headers: { accept: "application/json" } });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "사업을 삭제하지 못했습니다.");
      setCatalogNotice({ tone: "success", message: `“${program.title}”을 삭제했습니다. 기존 로드맵 복사본은 유지됩니다.` });
      if (catalog.items.length === 1 && catalogOffset > 0) setCatalogOffset(Math.max(0, catalogOffset - catalog.limit));
      else setCatalogRefresh((current) => current + 1);
    } catch (error) {
      setCatalogNotice({ tone: "error", message: error.message });
    } finally {
      setDeletingId(null);
    }
  };

  const handlePrint = async () => {
    if (pdfState.status !== "ready") return;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    setPdfState({ status: "printing", errors: [] });
    window.print();
    setPdfState({ status: "ready", errors: [] });
  };

  const printLabel = pdfState.status === "preflighting" ? "PDF 검증 중" : "PDF로 인쇄";
  const preflightOnlyErrors = pdfState.errors.filter((item) => !layout.errors.some((layoutError) => (
    layoutError.code === item.code && layoutError.path === item.path
  )));
  const canGoBack = catalogOffset > 0;
  const canGoForward = catalogOffset + catalog.items.length < catalog.total;
  const activePrograms = document.programs.filter((program) => program.category === activeCategory);
  const draggingProgram = document.programs.find((program) => program.id === draggingProgramId);

  return (
    <>
      <div className="preview-toolbar no-print">
        <div>
          <strong>ANP 연간 로드맵 제작</strong>
          <span>{mode === "roadmap" ? "A4 가로 · 1페이지 PDF 기준" : "공유 사업 카탈로그 관리"}</span>
        </div>
        {mode === "roadmap" ? <button type="button" onClick={handlePrint} disabled={pdfState.status !== "ready"}>{printLabel}</button> : null}
      </div>

      <nav className="workspace-switch no-print" aria-label="작업 화면">
        <button type="button" aria-pressed={mode === "roadmap"} onClick={() => switchMode("roadmap")}>로드맵 편집</button>
        <button type="button" aria-pressed={mode === "catalog"} onClick={() => switchMode("catalog")}>사업 카탈로그</button>
      </nav>

      {mode === "roadmap" ? (
        <>
          <p className="print-profile no-print">
            현재 {currentRuntime.family} {currentRuntime.major ?? "미확인"} · 출력 기준: Chromium {PDF_RUNTIME.major} · A4 가로 · 100% · 여백 없음 · 배경 그래픽 켬 · 머리글/바닥글 끔
          </p>

          <main className="preview-stage" data-pdf-status={pdfState.status} data-pdf-errors={pdfState.errors.map(({ code }) => code).join(",")}>
            <article className="roadmap-sheet" aria-label={`${layout.document.clientName || "미지정"} 연간 로드맵`}>
              <header className="sheet-header">
                <img className="brand-logo" src="/assets/anp-consulting-logo.png" alt="ANP Consulting" />
                <h1>{`올인원 컨설팅 서비스 연간 로드맵_${layout.document.clientName || "클라이언트명"}`}</h1>
                <p>Road to funds</p>
              </header>

              <section className="roadmap-table">
                <div className="month-row">
                  <div className="month-row__label">구분</div>
                  <div className="month-row__months">
                    {months.map((month) => <div key={month}>{month}</div>)}
                  </div>
                </div>

                <div className="roadmap-body">
                  <div className="watermark">ANP CONSULTING</div>
                  {layout.sections.map((section) => (
                    <div className={`roadmap-section roadmap-section--${section.key}`} key={section.key}>
                      <div className="roadmap-section__label">{section.label}</div>
                      <div className="roadmap-section__timeline">
                        {section.lanes.map((lane, laneIndex) => (
                          <div
                            className="roadmap-lane"
                            key={`${section.key}-${laneIndex}`}
                            data-drop-state={draggingProgram?.category === section.key
                              ? (moveProgramToLane({ programs: document.programs, programId: draggingProgramId, targetLaneIndex: laneIndex }).ok ? "valid" : "invalid")
                              : undefined}
                            onDragOver={(event) => {
                              if (draggingProgram?.category === section.key) event.preventDefault();
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              if (draggingProgram?.category === section.key) moveProgram(draggingProgramId, laneIndex);
                              endDrag();
                            }}
                          >
                            {lane.map((item) => (
                              <RoadmapEvent
                                item={item}
                                key={item.id}
                                dragging={item.id === draggingProgramId}
                                onDragStart={startDrag}
                                onDragEnd={endDrag}
                                onMove={moveProgram}
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="sheet-notes">
                <p>* 기타 사업의 경우 민간·인증에 따라 매년 새로 공고되는 지원사업을 탐색 후 맞춤식 지원을 도와드립니다.</p>
                <p>* 위 로드맵에 표기된 시기는 공고 및 지원금액에 따라 일부 조정될 수 있습니다.</p>
              </section>

              <footer className="sheet-footer">
                주식회사 ANP컨설팅&nbsp;&nbsp; | &nbsp;&nbsp;서울시 강서구 공항대로45길75,제일빌딩 6층&nbsp;&nbsp; | &nbsp;&nbsp;E. advisor@anpc.co.kr
              </footer>
            </article>
          </main>
          {layoutNotice ? <p className="layout-notice no-print" role="status" aria-live="polite">{layoutNotice}</p> : null}

          <section className="authoring-panel no-print" aria-labelledby="roadmap-editor-heading">
            <h2 id="roadmap-editor-heading" ref={roadmapHeading} tabIndex="-1">로드맵 편집</h2>
            <div className="authoring-header">
              <label>
                <span>클라이언트명</span>
                <input value={document.clientName} onChange={(event) => setDocument((current) => ({ ...current, clientName: event.target.value }))} />
              </label>
              <button type="button" onClick={addProgram}>사업 직접 추가</button>
            </div>
            <nav className="category-tabs" aria-label="사업 구분">
              {ROADMAP_CATEGORIES.map(({ key, label }) => (
                <button type="button" key={key} aria-pressed={activeCategory === key} onClick={() => setActiveCategory(key)}>{label}</button>
              ))}
            </nav>
            <div className="program-columns" aria-hidden="true">
              <span>구분</span><span>사업명</span><span>시작월</span><span>종료월</span><span>금액(원)</span><span />
            </div>
            <div className="program-list">
              {activePrograms.map((program) => (
                <ProgramEditor
                  key={program.id}
                  program={program}
                  onChange={(patch) => updateProgram(program.id, patch)}
                  onDelete={() => deleteProgram(program.id)}
                />
              ))}
            </div>
            {layout.errors.length > 0 && (
              <ul className="authoring-errors" aria-live="polite">
                {layout.errors.map((item, index) => <li key={`${item.code}-${item.path}-${index}`}><strong>{item.code}</strong> {item.message}</li>)}
              </ul>
            )}
            {preflightOnlyErrors.length > 0 && (
              <ul className="authoring-errors authoring-errors--preflight" aria-live="polite">
                {preflightOnlyErrors.map((item, index) => <li key={`${item.code}-${index}`}><strong>{item.code}</strong> {item.message}</li>)}
              </ul>
            )}
          </section>
        </>
      ) : (
        <section className="catalog-panel no-print" aria-labelledby="catalog-heading">
          <div className="catalog-heading">
            <div>
              <h2 id="catalog-heading" ref={catalogHeading} tabIndex="-1">사업 카탈로그</h2>
              <p>반복해서 사용하는 지원사업을 등록하고 로드맵에 독립 복사본으로 추가합니다.</p>
            </div>
            {!catalogForm ? <button type="button" className="button-secondary" onClick={() => openCatalogForm()}>새 사업 등록</button> : null}
          </div>

          {catalogForm ? (
            <CatalogForm
              form={catalogForm}
              state={catalogMutation}
              onChange={(values) => setCatalogForm((current) => ({ ...current, values }))}
              onCancel={() => setCatalogForm(null)}
              onSubmit={saveCatalog}
            />
          ) : (
            <>
              <form className="catalog-toolbar" onSubmit={(event) => {
                event.preventDefault();
                const nextQuery = catalogSearch.trim();
                setCatalogOffset(0);
                if (nextQuery === catalogQuery) setCatalogRefresh((current) => current + 1);
                else setCatalogQuery(nextQuery);
              }}>
                <label>
                  <span>사업 검색</span>
                  <input type="search" value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="사업명, 지원대상, 지원내용" />
                </label>
                <button type="submit" className="button-secondary">검색</button>
              </form>

              {catalogNotice ? (
                <div className={`catalog-notice catalog-notice--${catalogNotice.tone}`} role="status" aria-live="polite">
                  <span>{catalogNotice.message}</span>
                  {catalogNotice.returnToRoadmap ? <button type="button" onClick={() => switchMode("roadmap")}>로드맵 편집으로 이동</button> : null}
                </div>
              ) : null}

              {catalog.error ? (
                <div className="catalog-notice catalog-notice--error" role="alert">
                  <span>{catalog.error}</span>
                  <button type="button" onClick={() => setCatalogRefresh((current) => current + 1)}>다시 시도</button>
                </div>
              ) : null}

              <div className="catalog-list" aria-busy={catalog.status === "loading" || catalog.status === "refreshing"}>
                {catalog.status === "loading" ? <p className="catalog-state" role="status">저장된 사업을 불러오는 중입니다.</p> : null}
                {catalog.status !== "loading" && !catalog.items.length && !catalog.error ? (
                  <div className="catalog-state">
                    <strong>{catalogQuery ? "검색 결과가 없습니다." : "아직 등록된 사업이 없습니다."}</strong>
                    <span>{catalogQuery ? "검색어를 바꾸거나 전체 목록을 확인해 주세요." : "새 사업 등록으로 첫 사업을 저장해 주세요."}</span>
                  </div>
                ) : null}
                {catalog.items.map((program) => (
                  <article className="catalog-row" key={program.id}>
                    <div className="catalog-row__main">
                      <div className="catalog-row__title">
                        <span>{categoryLabel[program.category]}</span>
                        <h3>{program.title}</h3>
                      </div>
                      <dl className="catalog-row__meta">
                        <div><dt>지원금액</dt><dd>{program.amountKrw == null ? "금액 미정" : `최대 ${formatAmount(program.amountKrw)}`}</dd></div>
                        <div><dt>지원기간</dt><dd>{program.startMonth}~{program.endMonth}월</dd></div>
                      </dl>
                      {program.industries?.length || program.regions?.length ? (
                        <div className="catalog-row__tags">
                          {program.industries?.length ? <div><strong>업종</strong>{program.industries.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
                          {program.regions?.length ? <div><strong>지역</strong>{program.regions.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
                        </div>
                      ) : null}
                      <p><strong>지원대상</strong>{program.target}</p>
                      <details>
                        <summary>지원내용 보기</summary>
                        <p>{program.details}</p>
                      </details>
                      <a href={program.link} target="_blank" rel="noreferrer">공고 링크 열기</a>
                    </div>
                    <div className="catalog-row__actions">
                      <button type="button" className="button-primary" onClick={() => addCatalogProgram(program)}>로드맵에 추가</button>
                      <button type="button" className="button-tertiary" onClick={() => openCatalogForm(program)} aria-label={`${program.title} 편집`}>편집</button>
                      <button type="button" className="button-danger" onClick={() => deleteCatalogProgram(program)} disabled={deletingId === program.id} aria-label={`${program.title} 삭제`}>
                        {deletingId === program.id ? "삭제 중" : "삭제"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>

              {catalog.items.length ? (
                <div className="catalog-pagination">
                  <span>전체 {catalog.total}개 · {catalog.offset + 1}~{catalog.offset + catalog.items.length}</span>
                  <div>
                    <button type="button" className="button-secondary" disabled={!canGoBack} onClick={() => setCatalogOffset(Math.max(0, catalogOffset - catalog.limit))}>이전</button>
                    <button type="button" className="button-secondary" disabled={!canGoForward} onClick={() => setCatalogOffset(catalogOffset + catalog.limit)}>다음</button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
      )}
    </>
  );
}
