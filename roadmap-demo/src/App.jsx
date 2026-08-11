import { useEffect, useMemo, useRef, useState } from "react";
import { BUSINESS_SUBCATEGORY_OPTIONS, INDUSTRY_OPTIONS, REGION_OPTIONS } from "../catalog-options.js";
import { groupAdministrativeRegionOptions } from "../catalog-tag-policy.js";
import { formatAmount } from "./amount.js";
import { CATALOG_CATEGORIES, catalogPayload, copyCatalogProgram, EMPTY_CATALOG_PROGRAM, formatCatalogBulletText, parseCatalogText } from "./catalog.js";
import { runPdfPreflight } from "./pdf-preflight.js";
import { detectPdfRuntime, PDF_RUNTIME } from "./pdf-runtime.js";
import { allowedCategoriesForTier, buildRoadmapLayout, moveProgramToTargetLane, ROADMAP_CATEGORIES, resolveRoadmapTier, shiftProgramByMonths } from "./roadmap-policy.js";

const months = Array.from({ length: 12 }, (_, index) => `${index + 1}월`);
const currentSupportYear = new Date().getFullYear();
const categoryLabel = Object.fromEntries(ROADMAP_CATEGORIES.map(({ key, label }) => [key, label]));
const EMPTY_ROADMAP = Object.freeze({ clientName: "", programs: Object.freeze([]) });
const EMPTY_PPTX_STATE = Object.freeze({ status: "idle", error: "", message: "" });
const tierLabel = Object.freeze({ premium: "Premium", standard: "Standard" });
const feedbackStatusLabel = Object.freeze({
  needs_changes: "수정 필요",
  completed: "수정 완료",
  resolved: "해결",
});

async function readApiJson(response) {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("서버 응답 형식이 올바르지 않습니다.");
  }
  try {
    return await response.json();
  } catch {
    throw new Error("서버 응답을 읽지 못했습니다.");
  }
}

function formatSavedAt(value) {
  return new Date(value).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function formatFeedbackTime(value) {
  return new Date(value).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatCatalogPeriod(program, fallbackYear = currentSupportYear) {
  const year = Number(program.supportYear) || fallbackYear;
  const start = String(program.startMonth).padStart(2, "0");
  const end = String(program.endMonth).padStart(2, "0");
  return `${year}.${start}~${year}.${end}`;
}

function RoadmapEvent({
  item,
  dragging,
  selected,
  thread,
  composerOpen,
  composerDraft,
  leadPassword,
  leadAuthenticated,
  onLogout,
  feedbackMutation,
  roadmapSaved,
  onDragStart,
  onDragEnd,
  onMove,
  onShift,
  onOpen,
  onDraftChange,
  onPasswordChange,
  onComposerSubmit,
  onSaveRoadmap,
}) {
  const suppressClick = useRef(false);
  const moveByKeyboard = (event) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      onShift(item.id, event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    onMove(item.id, item.rowIndex + (event.key === "ArrowUp" ? -1 : 1));
  };
  const unresolved = thread && thread.status !== "resolved";
  const placeAbove = ["voucher", "ip", "certification"].includes(item.category);

  return (
    <div
      className={`roadmap-event roadmap-event--${item.category}${dragging ? " roadmap-event--dragging" : ""}${selected ? " roadmap-event--selected" : ""}${composerOpen ? " roadmap-event--composer-open" : ""}`}
      data-program-id={item.id}
      style={{ "--start": item.startOffset, "--span": item.span }}
    >
      <button
        type="button"
        className="roadmap-event__main"
        draggable
        aria-pressed={selected}
        aria-label={`${item.title}, ${categoryLabel[item.category]}.${unresolved ? " 미해결 피드백 있음." : ""} 위아래 화살표 키로 행 이동`}
        onDragStart={(event) => {
          suppressClick.current = true;
          onDragStart(event, item.id);
        }}
        onDragEnd={(event) => {
          onDragEnd(event);
          globalThis.setTimeout(() => { suppressClick.current = false; }, 0);
        }}
        onKeyDown={moveByKeyboard}
        onClick={() => {
          if (suppressClick.current) return;
          onOpen(item.id);
        }}
      >
        <span className="roadmap-event__copy">
          <span>{`[${categoryLabel[item.category]}] ${item.title}`}</span>
          {item.amountKrw != null ? <sup>{formatAmount(item.amountKrw)}</sup> : null}
        </span>
        <span className="roadmap-event__bar" />
        {unresolved ? <span className="roadmap-event__feedback-indicator roadmap-event__feedback-indicator--unresolved no-print">수정 필요</span> : null}
      </button>

      {composerOpen ? (
        <form
          className={`feedback-composer no-print${placeAbove ? " feedback-composer--above" : ""}`}
          onSubmit={(event) => onComposerSubmit(event, item.id)}
          onClick={(event) => event.stopPropagation()}
        >
          <strong>피드백 남기기</strong>
          {!roadmapSaved ? (
            <>
              <p>피드백을 연결하려면 로드맵을 먼저 저장해 주세요.</p>
              <button type="button" className="button-primary" onClick={onSaveRoadmap}>로드맵 저장</button>
            </>
          ) : (
            <>
              <textarea
                autoFocus
                value={composerDraft}
                onChange={(event) => onDraftChange(event.target.value)}
                placeholder="수정이 필요한 내용을 입력하세요"
                maxLength="2000"
                required
              />
              {!leadAuthenticated ? (
                <input
                  type="password"
                  value={leadPassword}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  placeholder="팀장 비밀번호"
                  autoComplete="current-password"
                  required
                />
              ) : <div className="feedback-session-status">팀장 인증됨 <button type="button" onClick={onLogout}>로그아웃</button></div>}
              {feedbackMutation.error ? <p className="feedback-error" role="alert">{feedbackMutation.error}</p> : null}
              <button type="submit" className="button-primary" disabled={feedbackMutation.status === "saving"}>
                {feedbackMutation.status === "saving" ? "등록 중" : "등록"}
              </button>
            </>
          )}
        </form>
      ) : null}
    </div>
  );
}

function FeedbackPanel({
  program,
  thread,
  leadAuthenticated,
  leadPassword,
  reworkDraft,
  mutation,
  onClose,
  onPasswordChange,
  onAuthenticate,
  onLogout,
  onReworkDraftChange,
  onAction,
}) {
  if (!program || !thread) return null;
  return (
    <aside className="feedback-panel no-print" aria-labelledby="feedback-panel-heading">
      <div className="feedback-panel__heading">
        <div>
          <span>피드백</span>
          <h2 id="feedback-panel-heading" tabIndex="-1">{program.title || "이름 없는 사업"}</h2>
        </div>
        <button type="button" className="feedback-panel__close" onClick={onClose} aria-label="피드백 닫기">닫기</button>
      </div>

      <p className={`feedback-status feedback-status--${thread.status}`}>{feedbackStatusLabel[thread.status]}</p>

      <ol className="feedback-timeline">
        {thread.events.map((event) => (
          <li key={event.id} className={`feedback-timeline__item feedback-timeline__item--${event.type}`}>
            <div>
              <strong>{event.role === "lead" || event.role === "team_lead" ? "팀장" : "담당자"}</strong>
              <time dateTime={event.createdAt}>{formatFeedbackTime(event.createdAt)}</time>
            </div>
            {event.text ? <p>{event.text}</p> : (
              <p>{event.type === "completed" ? "수정 완료로 표시했습니다." : "해결을 확인했습니다."}</p>
            )}
          </li>
        ))}
      </ol>

      {mutation.error ? <p className="feedback-error" role="alert">{mutation.error}</p> : null}

      {leadAuthenticated ? <div className="feedback-session-status">팀장 인증됨 <button type="button" onClick={onLogout}>로그아웃</button></div> : null}

      {thread.status === "needs_changes" ? (
        <div className="feedback-panel__actions">
          <button type="button" className="button-primary" disabled={mutation.status === "saving"} onClick={() => onAction("complete")}>
            수정 완료
          </button>
        </div>
      ) : null}

      {thread.status === "completed" && !leadAuthenticated ? (
        <form className="feedback-auth" onSubmit={onAuthenticate}>
          <label>
            <span>팀장 확인이 필요합니다</span>
            <input
              type="password"
              value={leadPassword}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder="팀장 비밀번호"
              autoComplete="current-password"
              required
            />
          </label>
          <button type="submit" className="button-primary" disabled={mutation.status === "saving"}>팀장 인증</button>
        </form>
      ) : null}

      {thread.status === "completed" && leadAuthenticated ? (
        <div className="feedback-review">
          <label>
            <span>재수정이 필요하면 이유를 입력하세요</span>
            <textarea
              value={reworkDraft}
              onChange={(event) => onReworkDraftChange(event.target.value)}
              placeholder="재수정 요청 내용"
              maxLength="2000"
            />
          </label>
          <div className="feedback-panel__actions">
            <button type="button" className="button-secondary" disabled={mutation.status === "saving" || !reworkDraft.trim()} onClick={() => onAction("rework")}>재수정 요청</button>
            <button type="button" className="button-primary" disabled={mutation.status === "saving"} onClick={() => onAction("resolve")}>해결 확인</button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function ProgramEditor({ program, categories, onChange, onDelete }) {
  const number = (value) => value === "" ? "" : Number(value);
  return (
    <div className="program-row">
      <select aria-label="구분" value={program.category} onChange={(event) => onChange({ category: event.target.value })}>
        {categories.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
      </select>
      <input aria-label="사업명" value={program.title} onChange={(event) => onChange({ title: event.target.value })} placeholder="사업명" />
      <input aria-label="시작월" type="number" min="1" max="12" value={program.startMonth} onChange={(event) => onChange({ startMonth: number(event.target.value) })} />
      <input aria-label="종료월" type="number" min="1" max="12" value={program.endMonth} onChange={(event) => onChange({ endMonth: number(event.target.value) })} />
      <input aria-label="금액" type="number" min="1" step="1" value={program.amountKrw ?? ""} onChange={(event) => onChange({ amountKrw: event.target.value === "" ? null : Number(event.target.value) })} placeholder="금액(원)" />
      <button type="button" className="delete-program" onClick={onDelete} aria-label={`${program.title || "새 사업"} 삭제`}>×</button>
    </div>
  );
}

function FieldError({ errors, name }) {
  return errors?.[name] ? <small className="field-error">{errors[name]}</small> : null;
}

function TagPicker({ label, options, value = [], onChange, onCreate, collapsible = false, maxSelections }) {
  const [query, setQuery] = useState("");
  const [createState, setCreateState] = useState({ status: "idle", error: "", message: "" });
  const selected = Array.isArray(value) ? value : [];
  const normalizedQuery = query.trim();
  const filtered = options.filter((option) => option.toLocaleLowerCase().includes(normalizedQuery.toLocaleLowerCase()));
  const hasExactMatch = options.includes(normalizedQuery);
  const toggle = (option) => onChange(selected.includes(option)
    ? selected.filter((item) => item !== option)
    : maxSelections === 1 ? [option] : [...selected, option]);
  const createOption = async () => {
    if (!normalizedQuery || createState.status === "saving") return;
    setCreateState({ status: "saving", error: "", message: "" });
    try {
      const option = await onCreate(normalizedQuery);
      if (!selected.includes(option)) onChange([...selected, option]);
      setQuery("");
      setCreateState({ status: "idle", error: "", message: `“${option}”을 공용 선택지로 추가했습니다.` });
    } catch (error) {
      setCreateState({ status: "error", error: error.message || "공용 선택지를 추가하지 못했습니다.", message: "" });
    }
  };

  const picker = (
    <fieldset className="tag-picker" aria-label={collapsible ? `${label} 복수 선택` : undefined}>
      <legend hidden={collapsible}>{label} <small>복수 선택</small></legend>
      {selected.length ? (
        <div className="tag-picker__selected" aria-label={`선택한 ${label}`}>
          {selected.map((option) => (
            <button type="button" key={option} onClick={() => toggle(option)} aria-label={`${option} 선택 해제`}>{option} ×</button>
          ))}
        </div>
      ) : <p className="tag-picker__empty">선택된 항목이 없습니다.</p>}
      <input type="search" value={query} onChange={(event) => {
        setQuery(event.target.value);
        if (createState.error || createState.message) setCreateState({ status: "idle", error: "", message: "" });
      }} placeholder={`${label} 검색`} aria-label={`${label} 검색`} />
      {onCreate && normalizedQuery && !hasExactMatch ? (
        <button type="button" className="tag-picker__create" onClick={createOption} disabled={createState.status === "saving"}>
          {createState.status === "saving" ? "추가 중" : `“${normalizedQuery}” 공용 선택지로 추가`}
        </button>
      ) : null}
      {createState.error ? <p className="tag-picker__status tag-picker__status--error" role="alert">{createState.error}</p> : null}
      {createState.message ? <p className="tag-picker__status" role="status">{createState.message}</p> : null}
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

  if (!collapsible) return picker;
  return (
    <details className="tag-picker-disclosure">
      <summary>
        <span>{label}</span>
        <span className="tag-picker-disclosure__count">{selected.length ? `${selected.length}개 선택` : "선택 안 함"}</span>
      </summary>
      {picker}
    </details>
  );
}

function RegionFilter({ options, value = [], onChange }) {
  const [query, setQuery] = useState("");
  const selected = Array.isArray(value) ? value : [];
  const grouped = useMemo(() => groupAdministrativeRegionOptions(options), [options]);
  const optionGroups = useMemo(() => new Map(
    grouped.groups.flatMap((group) => group.options.map((option) => [option, group])),
  ), [grouped]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searchResults = normalizedQuery ? grouped.groups.flatMap((group) => group.options
    .filter((option) => option.toLocaleLowerCase().includes(normalizedQuery)
      || group.label.toLocaleLowerCase().includes(normalizedQuery))
    .map((option) => ({ group, option }))) : [];
  const displayOption = (group, option) => option === group.key
    ? `${group.label} 전체`
    : option.startsWith(`${group.key} `) ? option.slice(group.key.length + 1) : option;
  const toggle = (option) => {
    if (selected.includes(option)) {
      onChange(selected.filter((item) => item !== option));
      return;
    }
    if (option === "전국") {
      onChange([option]);
      return;
    }
    const group = optionGroups.get(option);
    let next = selected.filter((item) => item !== "전국");
    if (group) {
      next = option === group.key
        ? next.filter((item) => !group.options.includes(item))
        : next.filter((item) => item !== group.key);
    }
    onChange([...next, option]);
  };
  const optionLabel = (group, option) => (
    <label key={option}>
      <input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} />
      <span>{displayOption(group, option)}</span>
    </label>
  );

  return (
    <details className="tag-picker-disclosure region-filter-disclosure">
      <summary>
        <span>지역 필터</span>
        <span className="tag-picker-disclosure__count">{selected.length ? `${selected.length}개 선택` : "선택 안 함"}</span>
      </summary>
      <fieldset className="tag-picker region-filter" aria-label="대한민국 행정구역별 지역 필터">
        {selected.length ? (
          <div className="tag-picker__selected" aria-label="선택한 지역 필터">
            {selected.map((option) => (
              <button type="button" key={option} onClick={() => toggle(option)} aria-label={`${option} 선택 해제`}>{option} ×</button>
            ))}
          </div>
        ) : <p className="tag-picker__empty">선택된 지역이 없습니다.</p>}
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="시·도, 시·군·구 검색" aria-label="지역 검색" />
        {normalizedQuery ? (
          <div className="region-filter__search-results" aria-label="지역 검색 결과">
            {searchResults.map(({ group, option }) => (
              <div className="region-filter__search-option" key={`${group.key}-${option}`}>
                <small>{group.label}</small>
                {optionLabel(group, option)}
              </div>
            ))}
            {!searchResults.length ? <p>검색 결과가 없습니다.</p> : null}
          </div>
        ) : (
          <>
            {grouped.nationwide ? (
              <label className="region-filter__nationwide">
                <input type="checkbox" checked={selected.includes("전국")} onChange={() => toggle("전국")} />
                <span>전국</span>
              </label>
            ) : null}
            <div className="region-filter__groups">
              {grouped.groups.map((group) => {
                const selectedCount = group.options.filter((option) => selected.includes(option)).length;
                return (
                  <details className="region-filter__group" key={group.key}>
                    <summary>
                      <span>{group.label}</span>
                      <small>{selectedCount ? `${selectedCount}개 선택` : `${Math.max(0, group.options.length - 1)}개 지역`}</small>
                    </summary>
                    <div className="region-filter__group-options" role="group" aria-label={`${group.label} 지역`}>
                      {group.options.map((option) => optionLabel(group, option))}
                    </div>
                  </details>
                );
              })}
            </div>
          </>
        )}
      </fieldset>
    </details>
  );
}

function CatalogForm({ categories, form, state, options, onChange, onCancel, onCreateOption, onDirty, onSubmit }) {
  const [importText, setImportText] = useState("");
  const [importErrors, setImportErrors] = useState([]);
  const values = form.values;
  const change = (name, value) => {
    onDirty();
    onChange({ ...values, [name]: value });
  };
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
      <fieldset className="catalog-form__fields" disabled={state.status === "saving"}>
      <div className="catalog-form__heading">
        <div>
          <h3>{form.mode === "create" ? "새 사업 등록" : "등록 사업 편집"}</h3>
          <p>저장한 내용은 사이트의 모든 방문자에게 공유됩니다.</p>
        </div>
        <button type="button" className="button-secondary" onClick={onCancel} disabled={state.status === "saving"}>목록으로</button>
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
              onDirty();
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

      {values.category === "business" ? (
        <label className="catalog-main-package-toggle">
          <input type="checkbox" checked={values.mainPackage === true} onChange={(event) => change("mainPackage", event.target.checked)} />
          <span><strong>메인패키지</strong> 직접 지정하는 사업화 태그입니다. 나머지 세부 태그는 사업명과 지원내용에서 자동 분류됩니다.</span>
        </label>
      ) : null}
      <FieldError errors={state.fields} name="mainPackage" />

      <div className="catalog-tag-pickers">
        <TagPicker
          label="업종"
          options={options.industries}
          value={values.industries}
          onChange={(next) => change("industries", next)}
          onCreate={null}
          maxSelections={1}
        />
        <TagPicker
          label="지역"
          options={options.regions}
          value={values.regions}
          onChange={(next) => change("regions", next)}
          onCreate={form.mode === "create" ? (value) => onCreateOption("region", value) : null}
        />
      </div>
      <FieldError errors={state.fields} name="industries" />
      <FieldError errors={state.fields} name="regions" />

      {form.mode === "edit" ? <div className="catalog-form__grid">
        <label>
          <span>구분</span>
          <select value={values.category} onChange={(event) => {
            const category = event.target.value;
            onDirty();
            onChange({ ...values, category, mainPackage: category === "business" && values.mainPackage === true });
          }} aria-invalid={invalid("category")}>
            {categories.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
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
          <input type="number" min="2000" max="2100" step="1" value={values.supportYear} onChange={(event) => change("supportYear", event.target.value)} aria-invalid={invalid("supportYear")} required />
          <FieldError errors={state.fields} name="supportYear" />
        </label>
        <label>
          <span>최대 지원금(원)</span>
          <input type="number" min="1" step="1" value={values.amountKrw} onChange={(event) => change("amountKrw", event.target.value)} aria-invalid={invalid("amountKrw")} placeholder="미정이면 비워두기" />
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
        <button type="button" className="button-secondary" onClick={onCancel} disabled={state.status === "saving"}>취소</button>
        <button type="submit" className="button-primary" disabled={state.status === "saving"}>
          {state.status === "saving" ? "저장 중" : form.mode === "create" ? "사업 등록" : "변경사항 저장"}
        </button>
      </div>
      </fieldset>
    </form>
  );
}

export function App() {
  const [screen, setScreen] = useState("library");
  const [document, setDocument] = useState(EMPTY_ROADMAP);
  const [roadmapId, setRoadmapId] = useState(null);
  const [savedSignature, setSavedSignature] = useState(JSON.stringify(EMPTY_ROADMAP));
  const [roadmaps, setRoadmaps] = useState({ status: "idle", items: [], error: "" });
  const [roadmapRefresh, setRoadmapRefresh] = useState(0);
  const [roadmapMutation, setRoadmapMutation] = useState({ status: "idle", error: "", message: "" });
  const [openingRoadmapId, setOpeningRoadmapId] = useState(null);
  const [deletingRoadmapId, setDeletingRoadmapId] = useState(null);
  const [pdfState, setPdfState] = useState({ status: "editing", errors: [] });
  const [pptxState, setPptxState] = useState(EMPTY_PPTX_STATE);
  const [mode, setMode] = useState("roadmap");
  const [catalog, setCatalog] = useState({ status: "idle", items: [], total: 0, limit: 50, offset: 0, error: "" });
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogCategory, setCatalogCategory] = useState(CATALOG_CATEGORIES[0].key);
  const [catalogSupportYear, setCatalogSupportYear] = useState(String(currentSupportYear));
  const [catalogStartMonth, setCatalogStartMonth] = useState("1");
  const [catalogEndMonth, setCatalogEndMonth] = useState("12");
  const [catalogIndustries, setCatalogIndustries] = useState([]);
  const [catalogRegions, setCatalogRegions] = useState([]);
  const [catalogBusinessSubcategories, setCatalogBusinessSubcategories] = useState([]);
  const [catalogOptions, setCatalogOptions] = useState({
    industries: [...INDUSTRY_OPTIONS],
    regions: [...REGION_OPTIONS],
    error: "",
  });
  const [catalogOffset, setCatalogOffset] = useState(0);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [catalogForm, setCatalogForm] = useState(null);
  const [catalogFormDirty, setCatalogFormDirty] = useState(false);
  const [catalogMutation, setCatalogMutation] = useState({ status: "idle", error: "", fields: {} });
  const [catalogNotice, setCatalogNotice] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [activeCategory, setActiveCategory] = useState(ROADMAP_CATEGORIES[0].key);
  const [draggingProgramId, setDraggingProgramId] = useState(null);
  const [layoutNotice, setLayoutNotice] = useState("");
  const [feedback, setFeedback] = useState({ status: "idle", items: [], error: "" });
  const [feedbackRefresh, setFeedbackRefresh] = useState(0);
  const [selectedFeedbackProgramId, setSelectedFeedbackProgramId] = useState(null);
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [reworkDraft, setReworkDraft] = useState("");
  const [leadPassword, setLeadPassword] = useState("");
  const [feedbackSession, setFeedbackSession] = useState({ status: "idle", authenticated: false });
  const [feedbackMutation, setFeedbackMutation] = useState({ status: "idle", error: "" });
  const libraryHeading = useRef(null);
  const roadmapHeading = useRef(null);
  const catalogHeading = useRef(null);
  const tierHeading = useRef(null);
  const moveFocus = useRef(false);
  const layout = useMemo(() => buildRoadmapLayout(document), [document]);
  const documentSignature = useMemo(() => JSON.stringify(document), [document]);
  const documentTier = resolveRoadmapTier(document);
  const allowedCategories = useMemo(() => allowedCategoriesForTier(documentTier), [documentTier]);
  const allowedCategoryKeys = useMemo(() => new Set(allowedCategories.map(({ key }) => key)), [allowedCategories]);
  const firstAllowedCategory = allowedCategories[0].key;
  const catalogCategories = useMemo(
    () => CATALOG_CATEGORIES.filter(({ key }) => allowedCategoryKeys.has(key)),
    [allowedCategoryKeys],
  );
  const catalogCategoryKeys = useMemo(() => new Set(catalogCategories.map(({ key }) => key)), [catalogCategories]);
  const firstCatalogCategory = catalogCategories[0].key;
  const isDirty = screen === "editor" && documentSignature !== savedSignature;
  const hasUnsavedWork = isDirty || catalogFormDirty;
  const currentRuntime = useMemo(() => detectPdfRuntime(), []);
  const feedbackByProgram = useMemo(() => Object.fromEntries(feedback.items.map((item) => [item.programId, item])), [feedback.items]);
  const selectedFeedbackThread = selectedFeedbackProgramId ? feedbackByProgram[selectedFeedbackProgramId] : null;
  const selectedFeedbackProgram = selectedFeedbackProgramId
    ? document.programs.find((program) => program.id === selectedFeedbackProgramId)
    : null;

  useEffect(() => {
    if (screen !== "editor") return undefined;
    let current = true;
    setPdfState({ status: "preflighting", errors: [] });
    runPdfPreflight({ roadmapDocument: document }).then((result) => {
      if (current) setPdfState({ status: result.ok ? "ready" : "blocked", errors: result.errors });
    });
    return () => { current = false; };
  }, [document, screen]);

  useEffect(() => {
    setPptxState((current) => current.status === "exporting" ? current : EMPTY_PPTX_STATE);
  }, [documentSignature]);

  useEffect(() => {
    if (screen !== "library") return undefined;
    const controller = new AbortController();
    setRoadmaps((current) => ({ ...current, status: current.items.length ? "refreshing" : "loading", error: "" }));
    fetch("/api/roadmaps?limit=50&offset=0", { signal: controller.signal, headers: { accept: "application/json" } })
      .then(async (response) => {
        const data = await readApiJson(response);
        if (!response.ok) throw new Error(data.error || "로드맵 목록을 불러오지 못했습니다.");
        return data;
      })
      .then((data) => setRoadmaps({ status: "ready", items: data.items, error: "" }))
      .catch((error) => {
        if (error.name !== "AbortError") setRoadmaps((current) => ({ ...current, status: "error", error: error.message }));
      });
    return () => controller.abort();
  }, [screen, roadmapRefresh]);

  useEffect(() => {
    if (!hasUnsavedWork) return undefined;
    const warnBeforeLeave = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [hasUnsavedWork]);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (screen === "library" ? libraryHeading : screen === "tier" ? tierHeading : mode === "roadmap" ? roadmapHeading : catalogHeading).current?.focus();
  }, [mode, screen]);

  useEffect(() => {
    if (screen !== "editor" || mode !== "catalog") return undefined;
    const controller = new AbortController();
    setCatalogOptions((current) => ({ ...current, error: "" }));
    fetch("/api/catalog-options", { signal: controller.signal, headers: { accept: "application/json" } })
      .then(async (response) => {
        const data = await readApiJson(response);
        if (!response.ok) throw new Error(data.error || "업종·지역 목록을 불러오지 못했습니다.");
        return data;
      })
      .then((data) => setCatalogOptions({ industries: data.industries, regions: data.regions, error: "" }))
      .catch((error) => {
        if (error.name !== "AbortError") setCatalogOptions((current) => ({ ...current, error: error.message }));
      });
    return () => controller.abort();
  }, [screen, mode]);

  useEffect(() => {
    if (screen !== "editor" || mode !== "catalog") return undefined;
    const controller = new AbortController();
    setCatalog((current) => ({ ...current, status: current.items.length ? "refreshing" : "loading", error: "" }));

    const params = new URLSearchParams({ limit: "50", offset: String(catalogOffset) });
    if (catalogQuery) params.set("q", catalogQuery);
    params.set("category", catalogCategoryKeys.has(catalogCategory) ? catalogCategory : firstCatalogCategory);
    params.set("supportYear", catalogSupportYear);
    params.set("startMonth", catalogStartMonth);
    params.set("endMonth", catalogEndMonth);
    catalogIndustries.forEach((value) => params.append("industry", value));
    catalogRegions.forEach((value) => params.append("region", value));
    if (catalogCategory === "business") {
      catalogBusinessSubcategories.forEach((value) => params.append("businessSubcategory", value));
    }
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
  }, [screen, mode, catalogQuery, catalogCategory, catalogSupportYear, catalogStartMonth, catalogEndMonth, catalogIndustries, catalogRegions, catalogBusinessSubcategories, catalogOffset, catalogRefresh, catalogCategoryKeys, firstCatalogCategory]);

  useEffect(() => {
    if (screen !== "editor" || mode !== "roadmap") return undefined;
    const controller = new AbortController();
    setFeedbackSession((current) => ({ ...current, status: "loading" }));
    fetch("/api/feedback-auth/session", {
      signal: controller.signal,
      credentials: "same-origin",
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        const data = await readApiJson(response);
        if (!response.ok) throw new Error(data.error || "팀장 인증 상태를 확인하지 못했습니다.");
        return data;
      })
      .then((data) => setFeedbackSession({ status: "ready", authenticated: Boolean(data.authenticated) }))
      .catch((error) => {
        if (error.name !== "AbortError") setFeedbackSession({ status: "error", authenticated: false });
      });
    return () => controller.abort();
  }, [screen, mode]);

  useEffect(() => {
    if (screen !== "editor" || mode !== "roadmap" || !roadmapId) {
      setFeedback({ status: "idle", items: [], error: "" });
      return undefined;
    }
    const controller = new AbortController();
    setFeedback((current) => ({ ...current, status: current.items.length ? "refreshing" : "loading", error: "" }));
    fetch(`/api/roadmaps/${encodeURIComponent(roadmapId)}/feedback`, {
      signal: controller.signal,
      credentials: "same-origin",
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        const data = await readApiJson(response);
        if (!response.ok) throw new Error(data.error || "피드백을 불러오지 못했습니다.");
        return data;
      })
      .then((data) => setFeedback({ status: "ready", items: data.items || [], error: "" }))
      .catch((error) => {
        if (error.name !== "AbortError") setFeedback((current) => ({ ...current, status: "error", error: error.message }));
      });
    return () => controller.abort();
  }, [screen, mode, roadmapId, feedbackRefresh]);

  useEffect(() => {
    if (!selectedFeedbackProgramId) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setSelectedFeedbackProgramId(null);
        setFeedbackDraft("");
        setReworkDraft("");
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedFeedbackProgramId]);

  const resetFeedbackUi = () => {
    setSelectedFeedbackProgramId(null);
    setFeedbackDraft("");
    setReworkDraft("");
    setLeadPassword("");
    setFeedbackMutation({ status: "idle", error: "" });
  };

  const startNewRoadmap = () => {
    setRoadmapMutation({ status: "idle", error: "", message: "" });
    setCatalogForm(null);
    setCatalogFormDirty(false);
    resetFeedbackUi();
    moveFocus.current = true;
    setScreen("tier");
  };

  const createRoadmapWithTier = (tier) => {
    const firstCategory = allowedCategoriesForTier(tier)[0].key;
    const blank = { tier, clientName: "", programs: [] };
    setDocument(blank);
    setRoadmapId(null);
    setSavedSignature(JSON.stringify(blank));
    setRoadmapMutation({ status: "idle", error: "", message: "" });
    setCatalogForm(null);
    setCatalogFormDirty(false);
    setActiveCategory(firstCategory);
    setCatalogCategory(CATALOG_CATEGORIES[0].key);
    setCatalogOffset(0);
    setMode("roadmap");
    resetFeedbackUi();
    moveFocus.current = true;
    setScreen("editor");
  };

  const cancelTierSelection = () => {
    setDocument(EMPTY_ROADMAP);
    setRoadmapId(null);
    setSavedSignature(JSON.stringify(EMPTY_ROADMAP));
    setRoadmapMutation({ status: "idle", error: "", message: "" });
    resetFeedbackUi();
    moveFocus.current = true;
    setScreen("library");
  };

  const openRoadmap = async (item) => {
    setOpeningRoadmapId(item.id);
    setRoadmaps((current) => ({ ...current, error: "" }));
    try {
      const response = await fetch(`/api/roadmaps/${encodeURIComponent(item.id)}`, { headers: { accept: "application/json" } });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "로드맵을 불러오지 못했습니다.");
      setDocument(data.item.document);
      setRoadmapId(data.item.id);
      setSavedSignature(JSON.stringify(data.item.document));
      setRoadmapMutation({ status: "idle", error: "", message: "" });
      setCatalogForm(null);
      setCatalogFormDirty(false);
      const nextFirstCategory = allowedCategoriesForTier(resolveRoadmapTier(data.item.document))[0].key;
      setActiveCategory(nextFirstCategory);
      setCatalogCategory(CATALOG_CATEGORIES[0].key);
      setCatalogOffset(0);
      setMode("roadmap");
      resetFeedbackUi();
      moveFocus.current = true;
      setScreen("editor");
    } catch (error) {
      setRoadmaps((current) => ({ ...current, status: "error", error: error.message }));
    } finally {
      setOpeningRoadmapId(null);
    }
  };

  const saveRoadmap = async () => {
    const snapshot = document;
    const editing = Boolean(roadmapId);
    setRoadmapMutation({ status: "saving", error: "", message: "" });
    try {
      const response = await fetch(editing ? `/api/roadmaps/${encodeURIComponent(roadmapId)}` : "/api/roadmaps", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(snapshot),
      });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "로드맵을 저장하지 못했습니다.");
      setRoadmapId(data.item.id);
      setSavedSignature(JSON.stringify(snapshot));
      setRoadmapMutation({ status: "idle", error: "", message: `“${snapshot.clientName || "이름 없는 로드맵"}”을 저장했습니다.` });
    } catch (error) {
      setRoadmapMutation({ status: "error", error: error.message || "네트워크 연결을 확인하고 다시 시도해 주세요.", message: "" });
    }
  };

  const showRoadmapLibrary = () => {
    if (roadmapMutation.status === "saving" || catalogMutation.status === "saving") return;
    if (hasUnsavedWork && !window.confirm("저장하지 않은 변경사항이 있습니다. 로드맵 목록으로 이동할까요?")) return;
    setCatalogForm(null);
    setCatalogFormDirty(false);
    resetFeedbackUi();
    setRoadmapRefresh((current) => current + 1);
    moveFocus.current = true;
    setScreen("library");
  };

  const deleteSavedRoadmap = async (item) => {
    const title = item.clientName || "이름 없는 로드맵";
    if (!window.confirm(`“${title}”을 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
    setDeletingRoadmapId(item.id);
    setRoadmaps((current) => ({ ...current, error: "" }));
    try {
      const response = await fetch(`/api/roadmaps/${encodeURIComponent(item.id)}`, { method: "DELETE", headers: { accept: "application/json" } });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "로드맵을 삭제하지 못했습니다.");
      setRoadmaps((current) => ({ ...current, items: current.items.filter((roadmap) => roadmap.id !== item.id) }));
      setRoadmapRefresh((current) => current + 1);
    } catch (error) {
      setRoadmaps((current) => ({ ...current, status: "error", error: error.message }));
    } finally {
      setDeletingRoadmapId(null);
    }
  };

  const switchMode = (nextMode) => {
    if (nextMode === mode) return;
    if (catalogMutation.status === "saving") return;
    if (mode === "catalog" && catalogFormDirty) {
      if (!window.confirm("저장하지 않은 사업 카탈로그 변경사항이 있습니다. 로드맵 편집으로 이동할까요?")) return;
      setCatalogForm(null);
      setCatalogFormDirty(false);
    }
    moveFocus.current = true;
    setMode(nextMode);
    if (nextMode !== "roadmap") resetFeedbackUi();
  };

  const updateProgram = (id, patch) => setDocument((current) => ({
    ...current,
    programs: current.programs.map((program) => {
      if (program.id !== id) return program;
      if (patch.category && !allowedCategoryKeys.has(patch.category)) return program;
      const next = { ...program, ...patch };
      if (patch.category && patch.category !== program.category) delete next.laneIndex;
      return next;
    }),
  }));

  const addProgram = () => setDocument((current) => {
    const category = allowedCategoryKeys.has(activeCategory) ? activeCategory : firstAllowedCategory;
    const nextSequence = current.programs.reduce((max, program) => Math.max(max, program.sequence), -1) + 1;
    return {
      ...current,
      programs: [...current.programs, {
        id: globalThis.crypto.randomUUID(), category, title: "", startMonth: 1, endMonth: 1, amountKrw: null, sequence: nextSequence,
      }],
    };
  });

  const addCatalogProgram = (program) => {
    if (!allowedCategoryKeys.has(program.category)) {
      setCatalogNotice({ tone: "error", message: "This category is not available for the selected roadmap tier." });
      return;
    }
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

  const laneDropResult = (programId, targetLaneIndex) => {
    return moveProgramToTargetLane({ programs: document.programs, programId, targetLaneIndex, tier: documentTier });
  };

  const moveProgram = (programId, targetLaneIndex) => {
    const result = laneDropResult(programId, targetLaneIndex);
    if (!result.ok) {
      setLayoutNotice("해당 행에는 배치할 수 없습니다.");
      return;
    }
    setDocument((current) => ({ ...current, programs: result.programs }));
    setLayoutNotice(result.outcome === "swapped-pair" ? "두 사업과 행을 교환했습니다." : result.outcome === "swapped" ? "겹치는 사업의 행을 교환했습니다." : "사업의 행을 이동했습니다.");
  };

  const shiftProgram = (programId, deltaMonths) => {
    const result = shiftProgramByMonths({ programs: document.programs, programId, deltaMonths, tier: documentTier });
    if (!result.ok) {
      setLayoutNotice("That month shift is not available.");
      return;
    }
    setDocument((current) => ({ ...current, programs: result.programs }));
    setLayoutNotice("Program period shifted by one month.");
  };

  const startDrag = (event, programId) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", programId);
    setLayoutNotice("");
    setDraggingProgramId(programId);
  };

  const endDrag = () => setDraggingProgramId(null);

  const openProgramFeedback = (programId) => {
    if (draggingProgramId || (roadmapId && feedback.status === "loading")) return;
    setSelectedFeedbackProgramId(programId);
    setFeedbackDraft("");
    setReworkDraft("");
    setFeedbackMutation({ status: "idle", error: "" });
    if (feedbackByProgram[programId]) {
      requestAnimationFrame(() => globalThis.document.getElementById("feedback-panel-heading")?.focus());
    }
  };

  const closeProgramFeedback = () => {
    const programId = selectedFeedbackProgramId;
    resetFeedbackUi();
    requestAnimationFrame(() => globalThis.document.querySelector(`[data-program-id="${programId}"] .roadmap-event__main`)?.focus());
  };

  const authenticateFeedbackLead = async (event) => {
    event?.preventDefault();
    if (!leadPassword) {
      setFeedbackMutation({ status: "error", error: "팀장 비밀번호를 입력해 주세요." });
      return false;
    }
    setFeedbackMutation({ status: "saving", error: "" });
    try {
      const response = await fetch("/api/feedback-auth/session", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-aio-feedback-action": "1",
        },
        body: JSON.stringify({ password: leadPassword }),
      });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "팀장 인증에 실패했습니다.");
      setFeedbackSession({ status: "ready", authenticated: true });
      setLeadPassword("");
      setFeedbackMutation({ status: "idle", error: "" });
      return true;
    } catch (error) {
      setFeedbackSession({ status: "ready", authenticated: false });
      setFeedbackMutation({ status: "error", error: error.message || "팀장 인증에 실패했습니다." });
      return false;
    }
  };

  const logoutFeedbackLead = async () => {
    setFeedbackMutation({ status: "saving", error: "" });
    try {
      const response = await fetch("/api/feedback-auth/session", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { accept: "application/json", "x-aio-feedback-action": "1" },
      });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "팀장 인증을 해제하지 못했습니다.");
      setFeedbackSession({ status: "ready", authenticated: false });
      setLeadPassword("");
      setFeedbackMutation({ status: "idle", error: "" });
    } catch (error) {
      setFeedbackMutation({ status: "error", error: error.message || "팀장 인증을 해제하지 못했습니다." });
    }
  };

  const submitInitialFeedback = async (event, programId) => {
    event.preventDefault();
    if (!roadmapId) {
      setFeedbackMutation({ status: "error", error: "로드맵을 저장한 후 피드백을 등록해 주세요." });
      return;
    }
    if (!feedbackDraft.trim()) return;
    let authenticated = feedbackSession.authenticated;
    if (!authenticated) authenticated = await authenticateFeedbackLead();
    if (!authenticated) return;

    setFeedbackMutation({ status: "saving", error: "" });
    try {
      const response = await fetch(`/api/roadmaps/${encodeURIComponent(roadmapId)}/feedback`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-aio-feedback-action": "1",
        },
        body: JSON.stringify({ programId, text: feedbackDraft.trim() }),
      });
      const data = await readApiJson(response);
      if (response.status === 401) setFeedbackSession({ status: "ready", authenticated: false });
      if (!response.ok) throw new Error(data.error || "피드백을 등록하지 못했습니다.");
      setFeedbackDraft("");
      setFeedbackMutation({ status: "idle", error: "" });
      setFeedbackRefresh((current) => current + 1);
    } catch (error) {
      setFeedbackMutation({ status: "error", error: error.message || "피드백을 등록하지 못했습니다." });
    }
  };

  const performFeedbackAction = async (action) => {
    if (!roadmapId || !selectedFeedbackProgramId) return;
    if (action === "rework" && !reworkDraft.trim()) return;
    setFeedbackMutation({ status: "saving", error: "" });
    try {
      const response = await fetch(`/api/roadmaps/${encodeURIComponent(roadmapId)}/feedback/${encodeURIComponent(selectedFeedbackProgramId)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-aio-feedback-action": "1",
        },
        body: JSON.stringify({ action, ...(action === "rework" ? { text: reworkDraft.trim() } : {}) }),
      });
      const data = await readApiJson(response);
      if (response.status === 401) setFeedbackSession({ status: "ready", authenticated: false });
      if (!response.ok) throw new Error(data.error || "피드백 상태를 변경하지 못했습니다.");
      setReworkDraft("");
      setFeedbackMutation({ status: "idle", error: "" });
      setFeedbackRefresh((current) => current + 1);
    } catch (error) {
      setFeedbackMutation({ status: "error", error: error.message || "피드백 상태를 변경하지 못했습니다." });
    }
  };

  const openCatalogForm = (program = null) => {
    setCatalogMutation({ status: "idle", error: "", fields: {} });
    setCatalogNotice(null);
    setCatalogFormDirty(false);
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
      setCatalogFormDirty(false);
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

  const createCatalogOption = async (kind, value) => {
    const response = await fetch("/api/catalog-options", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ kind, value }),
    });
    const data = await readApiJson(response);
    if (!response.ok) throw new Error(data.error || "공용 선택지를 추가하지 못했습니다.");
    const key = kind === "industry" ? "industries" : "regions";
    setCatalogOptions((current) => ({
      ...current,
      [key]: [...new Set([...current[key], data.item.value])].sort((left, right) => left.localeCompare(right, "ko")),
    }));
    return data.item.value;
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

  const handlePptxExport = async () => {
    if (pptxState.status === "exporting") return;
    if (layout.errors.length) {
      setPptxState({
        status: "error",
        error: "입력 또는 배치 오류를 해결한 뒤 PPTX로 내보내 주세요.",
        message: "",
      });
      return;
    }
    setPptxState({ status: "exporting", error: "", message: "" });
    try {
      const { exportRoadmapPptx } = await import("./pptx-export.js");
      const fileName = await exportRoadmapPptx({ layout });
      setPptxState({ status: "success", error: "", message: `${fileName} 다운로드를 시작했습니다.` });
    } catch (error) {
      setPptxState({
        status: "error",
        error: error?.message || "PPTX 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
        message: "",
      });
    }
  };

  if (screen === "library") {
    const listBusy = openingRoadmapId !== null || deletingRoadmapId !== null;
    return (
      <main className="catalog-panel no-print" aria-labelledby="roadmap-library-heading">
        <div className="catalog-heading">
          <div>
            <h1 id="roadmap-library-heading" ref={libraryHeading} tabIndex="-1">저장된 로드맵</h1>
            <p>기존 로드맵을 열거나 새 로드맵을 만듭니다.</p>
          </div>
          <button type="button" className="button-primary" onClick={startNewRoadmap} disabled={listBusy}>새 로드맵 만들기</button>
        </div>

        <p className="catalog-notice catalog-notice--warning" role="note">
          이 목록과 로드맵은 모든 방문자가 보고 수정하거나 삭제할 수 있습니다. 민감한 고객 정보는 저장하지 마세요.
        </p>

        {roadmaps.error ? (
          <div className="catalog-notice catalog-notice--error" role="alert">
            <span>{roadmaps.error}</span>
            <button type="button" onClick={() => setRoadmapRefresh((current) => current + 1)}>다시 시도</button>
          </div>
        ) : null}

        <div className="catalog-list" aria-busy={roadmaps.status === "loading" || roadmaps.status === "refreshing"}>
          {roadmaps.status === "loading" ? <p className="catalog-state" role="status">저장된 로드맵을 불러오는 중입니다.</p> : null}
          {roadmaps.status !== "loading" && !roadmaps.items.length && !roadmaps.error ? (
            <div className="catalog-state">
              <strong>아직 저장된 로드맵이 없습니다.</strong>
              <span>새 로드맵을 만든 뒤 편집 화면에서 저장해 주세요.</span>
            </div>
          ) : null}
          {roadmaps.items.map((item) => {
            const title = item.clientName || "이름 없는 로드맵";
            return (
              <article className="catalog-row catalog-row--roadmap" key={item.id}>
                <div className="catalog-row__main">
                  <div className="catalog-row__title"><h2>{title}</h2></div>
                  <dl className="catalog-row__meta">
                    <div><dt>Tier</dt><dd><span className="tier-badge no-print">{tierLabel[resolveRoadmapTier(item)]}</span></dd></div>
                    <div><dt>마지막 저장</dt><dd>{formatSavedAt(item.updatedAt)}</dd></div>
                  </dl>
                </div>
                <div className="catalog-row__actions">
                  <button type="button" className="button-primary" onClick={() => openRoadmap(item)} disabled={listBusy}>
                    {openingRoadmapId === item.id ? "여는 중" : "열기"}
                  </button>
                  <button type="button" className="button-danger" onClick={() => deleteSavedRoadmap(item)} disabled={listBusy} aria-label={`${title} 영구 삭제`}>
                    {deletingRoadmapId === item.id ? "삭제 중" : "삭제"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </main>
    );
  }

  if (screen === "tier") {
    return (
      <main className="tier-choice no-print" aria-labelledby="tier-choice-heading">
        <div className="tier-choice__panel">
          <div>
            <h1 id="tier-choice-heading" ref={tierHeading} tabIndex="-1">로드맵 유형 선택</h1>
            <p>새 문서에 적용할 유형을 선택하세요. 만든 뒤에는 변경할 수 없습니다.</p>
          </div>
          <div className="tier-choice__actions">
            <button type="button" className="button-primary" onClick={() => createRoadmapWithTier("premium")}>
              Premium
            </button>
            <button type="button" className="button-secondary" onClick={() => createRoadmapWithTier("standard")}>
              Standard
            </button>
          </div>
          <button type="button" className="button-tertiary" onClick={cancelTierSelection}>취소</button>
        </div>
      </main>
    );
  }

  const printLabel = pdfState.status === "preflighting" ? "PDF 검증 중" : "PDF로 인쇄";
  const pptxLabel = pptxState.status === "exporting" ? "PPTX 생성 중" : "PPTX 다운로드";
  const preflightOnlyErrors = pdfState.errors.filter((item) => !layout.errors.some((layoutError) => (
    layoutError.code === item.code && layoutError.path === item.path
  )));
  const canGoBack = catalogOffset > 0;
  const canGoForward = catalogOffset + catalog.items.length < catalog.total;
  const hasCatalogFilters = Boolean(catalogQuery || catalogIndustries.length || catalogRegions.length || catalogBusinessSubcategories.length);
  const activePrograms = document.programs.filter((program) => program.category === activeCategory && allowedCategoryKeys.has(program.category));
  const draggingProgram = document.programs.find((program) => program.id === draggingProgramId);

  return (
    <>
      <div className="preview-toolbar no-print">
        <div className="preview-toolbar__brand">
          <img className="product-brand-icon" src="/assets/aio-roadmap-studio-icon.png" alt="" />
          <div>
            <strong>AIO Roadmap Studio</strong>
            <span>{mode === "roadmap" ? "A4 가로 · 1페이지 PDF 기준" : "공유 사업 카탈로그 관리"}</span>
          </div>
        </div>
        <div className="preview-toolbar__actions">
          <button type="button" onClick={showRoadmapLibrary} disabled={roadmapMutation.status === "saving" || catalogMutation.status === "saving"}>로드맵 목록</button>
          <button type="button" onClick={saveRoadmap} disabled={roadmapMutation.status === "saving"}>
            {roadmapMutation.status === "saving" ? "저장 중" : "로드맵 저장"}
          </button>
          {mode === "roadmap" ? (
            <button type="button" onClick={handlePptxExport} disabled={pptxState.status === "exporting" || layout.errors.length > 0}>
              {pptxLabel}
            </button>
          ) : null}
          {mode === "roadmap" ? <button type="button" onClick={handlePrint} disabled={pdfState.status !== "ready"}>{printLabel}</button> : null}
        </div>
      </div>

      <nav className="workspace-switch no-print" aria-label="작업 화면">
        <button type="button" aria-pressed={mode === "roadmap"} onClick={() => switchMode("roadmap")} disabled={catalogMutation.status === "saving"}>로드맵 편집</button>
        <button type="button" aria-pressed={mode === "catalog"} onClick={() => switchMode("catalog")}>사업 카탈로그</button>
      </nav>

      {roadmapMutation.error ? <p className="roadmap-save-status catalog-notice catalog-notice--error no-print" role="alert">{roadmapMutation.error}</p>
        : roadmapMutation.status === "saving" ? <p className="roadmap-save-status catalog-notice no-print" role="status">로드맵을 저장하는 중입니다.</p>
          : hasUnsavedWork ? <p className="roadmap-save-status catalog-notice catalog-notice--warning no-print" role="status">저장되지 않은 변경사항이 있습니다.</p>
            : roadmapMutation.message ? <p className="roadmap-save-status catalog-notice catalog-notice--success no-print" role="status">{roadmapMutation.message}</p> : null}

      {mode === "roadmap" ? (
        <>
          <p className="print-profile no-print">
            현재 {currentRuntime.family} {currentRuntime.major ?? "미확인"} · 출력 기준: Chromium 기반 브라우저 · A4 가로 · 100% · 여백 없음 · 배경 그래픽 켬 · 머리글/바닥글 끔
          </p>
          {pptxState.error ? <p className="pptx-export-status pptx-export-status--error no-print" role="alert">{pptxState.error}</p>
            : pptxState.message ? <p className="pptx-export-status no-print" role="status">{pptxState.message}</p> : null}

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
                              ? (laneDropResult(draggingProgramId, laneIndex).ok ? "valid" : "invalid")
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
                                selected={item.id === selectedFeedbackProgramId}
                                thread={feedbackByProgram[item.id]}
                                composerOpen={item.id === selectedFeedbackProgramId && !feedbackByProgram[item.id]}
                                composerDraft={feedbackDraft}
                                leadPassword={leadPassword}
                                leadAuthenticated={feedbackSession.authenticated}
                                onLogout={logoutFeedbackLead}
                                feedbackMutation={feedbackMutation}
                                roadmapSaved={Boolean(roadmapId)}
                                onDragStart={startDrag}
                                onDragEnd={endDrag}
                                onMove={moveProgram}
                                onShift={shiftProgram}
                                onOpen={openProgramFeedback}
                                onDraftChange={setFeedbackDraft}
                                onPasswordChange={setLeadPassword}
                                onComposerSubmit={submitInitialFeedback}
                                onSaveRoadmap={saveRoadmap}
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
          {feedback.error ? (
            <div className="feedback-load-error catalog-notice catalog-notice--error no-print" role="alert">
              <span>{feedback.error}</span>
              <button type="button" onClick={() => setFeedbackRefresh((current) => current + 1)}>다시 시도</button>
            </div>
          ) : null}

          <section className="authoring-panel no-print" aria-labelledby="roadmap-editor-heading">
            <h2 id="roadmap-editor-heading" ref={roadmapHeading} tabIndex="-1">로드맵 편집</h2>
            <p className="tier-badge tier-badge--editor no-print" aria-label="로드맵 유형">{tierLabel[documentTier]}</p>
            <div className="authoring-header">
              <label>
                <span>클라이언트명</span>
                <input value={document.clientName} onChange={(event) => setDocument((current) => ({ ...current, clientName: event.target.value }))} />
              </label>
              <button type="button" onClick={addProgram}>사업 직접 추가</button>
            </div>
            <nav className="category-tabs" aria-label="사업 구분">
              {allowedCategories.map(({ key, label }) => (
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
                  categories={allowedCategories}
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

          <FeedbackPanel
            program={selectedFeedbackProgram}
            thread={selectedFeedbackThread}
            leadAuthenticated={feedbackSession.authenticated}
            leadPassword={leadPassword}
            reworkDraft={reworkDraft}
            mutation={feedbackMutation}
            onClose={closeProgramFeedback}
            onPasswordChange={setLeadPassword}
            onAuthenticate={authenticateFeedbackLead}
            onLogout={logoutFeedbackLead}
            onReworkDraftChange={setReworkDraft}
            onAction={performFeedbackAction}
          />
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
              categories={catalogCategories}
              form={catalogForm}
              state={catalogMutation}
              options={catalogOptions}
              onChange={(values) => setCatalogForm((current) => ({ ...current, values }))}
              onCancel={() => {
                setCatalogForm(null);
                setCatalogFormDirty(false);
              }}
              onCreateOption={createCatalogOption}
              onDirty={() => setCatalogFormDirty(true)}
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
              <nav className="category-tabs catalog-category-tabs" aria-label="사업 카탈로그 구분">
                {catalogCategories.map(({ key, label }) => (
                  <button type="button" key={key} aria-pressed={catalogCategory === key} onClick={() => {
                    setCatalogCategory(key);
                    if (key !== "business") setCatalogBusinessSubcategories([]);
                    setCatalogOffset(0);
                  }}>{label}</button>
                ))}
              </nav>

              <section className="catalog-filters" aria-label="세부 분류, 업종 및 지역 필터">
                {catalogCategory === "business" ? (
                  <TagPicker collapsible label="사업화 세부 분류" options={BUSINESS_SUBCATEGORY_OPTIONS} value={catalogBusinessSubcategories} onChange={(next) => {
                    setCatalogBusinessSubcategories(next);
                    setCatalogOffset(0);
                  }} />
                ) : null}
                <TagPicker collapsible label="업종 필터" options={catalogOptions.industries} value={catalogIndustries} onChange={(next) => {
                  setCatalogIndustries(next);
                  setCatalogOffset(0);
                }} />
                <RegionFilter options={catalogOptions.regions} value={catalogRegions} onChange={(next) => {
                  setCatalogRegions(next);
                  setCatalogOffset(0);
                }} />
              </section>
              {catalogIndustries.length || catalogRegions.length || catalogBusinessSubcategories.length ? (
                <div className="catalog-filter-actions">
                  <span>각 필터 안에서는 하나 이상, 필터 간에는 모든 조건을 만족하는 사업을 찾습니다.</span>
                  <button type="button" className="button-tertiary" onClick={() => {
                    setCatalogBusinessSubcategories([]);
                    setCatalogIndustries([]);
                    setCatalogRegions([]);
                    setCatalogOffset(0);
                  }}>필터 초기화</button>
                </div>
              ) : null}

              {catalogOptions.error ? <p className="catalog-notice catalog-notice--error" role="alert">{catalogOptions.error}</p> : null}

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
                    <strong>{hasCatalogFilters ? "필터 결과가 없습니다." : "아직 등록된 사업이 없습니다."}</strong>
                    <span>{hasCatalogFilters ? "검색어나 세부 분류·업종·지역 조건을 바꿔 주세요." : "새 사업 등록으로 첫 사업을 저장해 주세요."}</span>
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
                        {program.businessSubcategories?.length ? <div><dt>세부 분류</dt><dd>{program.businessSubcategories.map((tag) => <span key={tag}>{tag}</span>)}</dd></div> : null}
                        {program.industries?.length ? <div><dt>업종</dt><dd>{program.industries.map((tag) => <span key={tag}>{tag}</span>)}</dd></div> : null}
                        {program.regions?.length ? <div><dt>지역</dt><dd>{program.regions.map((tag) => <span key={tag}>{tag}</span>)}</dd></div> : null}
                      </dl>
                      <details>
                        <summary>사업 상세보기</summary>
                        <p className="catalog-row__detail"><strong>지원대상:</strong><span>{formatCatalogBulletText(program.target)}</span></p>
                        <p className="catalog-row__detail"><strong>지원 내용:</strong><span>{formatCatalogBulletText(program.details)}</span></p>
                        <p className="catalog-row__detail"><strong>공고 링크:</strong><a href={program.link} target="_blank" rel="noreferrer">공고 링크 열기</a></p>
                      </details>
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
