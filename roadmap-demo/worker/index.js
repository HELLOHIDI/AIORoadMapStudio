import {
  BUSINESS_COMPETITION_TERMS,
  BUSINESS_SUBCATEGORY_OPTIONS,
  FOREIGN_COUNTRY_NAMES,
  INDUSTRY_OPTIONS,
  LEGACY_INVALID_REGION_OPTIONS,
  NON_INDUSTRY_OPTIONS,
  REGION_OPTIONS,
  inferBusinessSubcategories,
} from "../catalog-options.js";
import { formatCatalogBulletText } from "../catalog-readability.js";

const CATALOG_PATH = "/api/catalog-programs";
const CATALOG_OPTIONS_PATH = "/api/catalog-options";
const ROADMAP_PATH = "/api/roadmaps";
const FEEDBACK_AUTH_PATH = "/api/feedback-auth/session";
const CATEGORIES = new Set(["consulting", "business", "voucher", "ip", "certification"]);
const CATALOG_CATEGORIES = new Set(["business", "voucher", "ip", "certification"]);
const ROADMAP_TIERS = new Set(["premium", "standard"]);
const STANDARD_ROADMAP_CATEGORIES = new Set(["consulting", "business", "voucher", "ip"]);
const FIELDS = new Set(["category", "title", "link", "amountKrw", "startMonth", "endMonth", "target", "details", "industries", "regions", "mainPackage"]);
const ROADMAP_FIELDS = new Set(["tier", "clientName", "programs"]);
const ROADMAP_PROGRAM_FIELDS = new Set(["id", "category", "displayCategory", "title", "link", "amountKrw", "startMonth", "endMonth", "target", "details", "sequence", "laneIndex"]);
const INDUSTRIES = new Set(INDUSTRY_OPTIONS);
const NON_INDUSTRIES = new Set(NON_INDUSTRY_OPTIONS);
const REGIONS = new Set(REGION_OPTIONS);
const BUSINESS_SUBCATEGORIES = new Set(BUSINESS_SUBCATEGORY_OPTIONS);
const INVALID_REGIONS = new Set(LEGACY_INVALID_REGION_OPTIONS);
const OPTION_KINDS = new Set(["region"]);
const MAX_BODY_BYTES = 500_000;
const MAX_ROADMAP_PROGRAMS = 500;
const FEEDBACK_ACTIONS = new Set(["complete", "resolve", "rework"]);
const FEEDBACK_COOKIE = "feedback_session";
const FEEDBACK_SESSION_SECONDS = 8 * 60 * 60;
const FEEDBACK_RETRY_WINDOW_SECONDS = 15 * 60;
const FEEDBACK_RETRY_LOCK_SECONDS = 15 * 60;
const FEEDBACK_RETRY_LIMIT = 5;

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers });
}

function apiError(status, error, fields) {
  return json({ error, ...(fields ? { fields } : {}) }, status);
}

function resourceId(pathname, basePath) {
  const match = pathname.match(new RegExp(`^${basePath}/([^/]+)$`));
  if (!match) return null;
  const id = decodeURIComponent(match[1]);
  return /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : "";
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanFeedbackText(value) {
  const text = cleanString(value);
  return text && text.length <= 4000 ? text : "";
}

function isJsonRequest(request) {
  return /^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "");
}

function hasOnlyFields(value, allowed) {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => allowed.has(key));
}

function requireFeedbackActionHeader(request) {
  return request.headers.get("x-aio-feedback-action") === "1"
    ? null
    : apiError(403, "FEEDBACK_ACTION_HEADER_REQUIRED");
}

function feedbackPath(pathname) {
  const collection = pathname.match(/^\/api\/roadmaps\/([^/]+)\/feedback$/);
  if (collection) {
    const roadmapId = decodeURIComponent(collection[1]);
    return /^[A-Za-z0-9_-]{1,100}$/.test(roadmapId) ? { roadmapId } : null;
  }
  const item = pathname.match(/^\/api\/roadmaps\/([^/]+)\/feedback\/([^/]+)$/);
  if (!item) return null;
  const roadmapId = decodeURIComponent(item[1]);
  const programId = decodeURIComponent(item[2]);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(roadmapId) || !/^[A-Za-z0-9_-]{1,100}$/.test(programId)) return null;
  return { roadmapId, programId };
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

async function pbkdf2Hash(password, salt, iterations, byteLength) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    byteLength * 8,
  );
  return new Uint8Array(bits);
}

function feedbackPasswordConfig(env) {
  const value = cleanString(env.FEEDBACK_PASSWORD_HASH);
  const parts = value.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return null;
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) return null;
  try {
    const salt = base64UrlToBytes(parts[2]);
    const expected = base64UrlToBytes(parts[3]);
    if (!salt.length || expected.length < 16) return null;
    return { raw: value, iterations, salt, expected };
  } catch {
    return null;
  }
}

async function verifyFeedbackPassword(password, config) {
  if (typeof password !== "string" || password.length > 1024) return false;
  const actual = await pbkdf2Hash(password, config.salt, config.iterations, config.expected.length);
  return equalBytes(actual, config.expected);
}

function cookieValue(request, name) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const segment of cookie.split(";")) {
    const [key, ...valueParts] = segment.trim().split("=");
    if (key === name) return valueParts.join("=");
  }
  return "";
}

function feedbackCookieAttributes(request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Strict${secure}`;
}

function clearFeedbackCookie(request, headers = {}) {
  return {
    ...headers,
    "Set-Cookie": `${FEEDBACK_COOKIE}=; Max-Age=0; ${feedbackCookieAttributes(request)}`,
  };
}

async function cleanupExpiredFeedbackSessions(db, now) {
  await db.prepare("DELETE FROM feedback_auth_sessions WHERE expires_at <= ?").bind(now).run();
}

async function hasLeadSession(request, env) {
  const config = feedbackPasswordConfig(env);
  const token = cookieValue(request, FEEDBACK_COOKIE);
  if (!config || !token) return false;
  const tokenHash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`SELECT token_hash AS tokenHash FROM feedback_auth_sessions
    WHERE token_hash = ? AND secret_version = ? AND expires_at > ?`)
    .bind(tokenHash, await sha256Hex(config.raw), now)
    .first();
  return !!row;
}

async function requireLeadSession(request, env) {
  return (await hasLeadSession(request, env)) ? null : apiError(401, "FEEDBACK_LEAD_SESSION_REQUIRED");
}

function retryKey(request) {
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return `lead:${ip.slice(0, 100)}`;
}

async function isFeedbackAuthLocked(db, key, now) {
  const row = await db.prepare("SELECT count, window_start AS windowStart, locked_until AS lockedUntil FROM feedback_auth_attempts WHERE attempt_key = ?")
    .bind(key)
    .first();
  return !!row && Number(row.lockedUntil) > now;
}

async function recordFeedbackAuthFailure(db, key, now) {
  const row = await db.prepare("SELECT count, window_start AS windowStart FROM feedback_auth_attempts WHERE attempt_key = ?").bind(key).first();
  if (!row || now - Number(row.windowStart) > FEEDBACK_RETRY_WINDOW_SECONDS) {
    await db.prepare("INSERT OR REPLACE INTO feedback_auth_attempts (attempt_key, count, window_start, locked_until) VALUES (?, ?, ?, ?)")
      .bind(key, 1, now, 0)
      .run();
    return;
  }
  const count = Number(row.count) + 1;
  const lockedUntil = count >= FEEDBACK_RETRY_LIMIT ? now + FEEDBACK_RETRY_LOCK_SECONDS : 0;
  await db.prepare("UPDATE feedback_auth_attempts SET count = ?, locked_until = ? WHERE attempt_key = ?")
    .bind(count, lockedUntil, key)
    .run();
}

async function handleFeedbackAuth(request, env) {
  if (request.method === "GET") return json({ authenticated: await hasLeadSession(request, env) });
  if (request.method === "DELETE") {
    const token = cookieValue(request, FEEDBACK_COOKIE);
    if (token) {
      await env.DB.prepare("DELETE FROM feedback_auth_sessions WHERE token_hash = ?")
        .bind(await sha256Hex(token))
        .run();
    }
    return json({ authenticated: false }, 200, clearFeedbackCookie(request));
  }
  if (request.method !== "POST") return apiError(405, "UNSUPPORTED_METHOD");
  const actionHeaderError = requireFeedbackActionHeader(request);
  if (actionHeaderError) return actionHeaderError;
  if (!isJsonRequest(request)) return apiError(415, "JSON_CONTENT_TYPE_REQUIRED");

  const config = feedbackPasswordConfig(env);
  if (!config) return apiError(503, "FEEDBACK_AUTH_NOT_CONFIGURED");
  const now = Math.floor(Date.now() / 1000);
  await cleanupExpiredFeedbackSessions(env.DB, now);
  const key = retryKey(request);
  if (await isFeedbackAuthLocked(env.DB, key, now)) return apiError(429, "FEEDBACK_AUTH_LOCKED");

  const body = await readBody(request);
  if (body.error) return apiError(body.status ?? 400, body.error);
  if (!hasOnlyFields(body.value, new Set(["password"]))) return apiError(400, "FEEDBACK_INPUT_INVALID");
  const ok = await verifyFeedbackPassword(body.value?.password, config);
  if (!ok) {
    await recordFeedbackAuthFailure(env.DB, key, now);
    return apiError(401, "FEEDBACK_AUTH_FAILED");
  }

  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = bytesToBase64Url(tokenBytes);
  const expiresAtSeconds = now + FEEDBACK_SESSION_SECONDS;
  await env.DB.prepare("DELETE FROM feedback_auth_attempts WHERE attempt_key = ?").bind(key).run();
  await env.DB.prepare("INSERT INTO feedback_auth_sessions (token_hash, secret_version, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), await sha256Hex(config.raw), now, expiresAtSeconds)
    .run();
  return json(
    { authenticated: true, expiresAt: new Date(expiresAtSeconds * 1000).toISOString() },
    200,
    { "Set-Cookie": `${FEEDBACK_COOKIE}=${token}; Max-Age=${FEEDBACK_SESSION_SECONDS}; ${feedbackCookieAttributes(request)}` },
  );
}

function cleanTags(value, allowed, label, fields) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    fields[label] = "여러 항목을 선택해 주세요.";
    return [];
  }
  const tags = [...new Set(value.map(cleanString))];
  if (tags.some((tag) => !allowed.has(tag))) fields[label] = "제공된 목록에서 선택해 주세요.";
  return tags;
}

export function validateCatalogProgram(input) {
  return validateCatalogProgramWithOptions(input, { industries: INDUSTRIES, regions: REGIONS });
}

function validateCatalogProgramWithOptions(input, options) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "사업 정보를 JSON 객체로 입력해 주세요." };
  }

  const unknown = Object.keys(input).filter((key) => !FIELDS.has(key));
  if (unknown.length) return { error: `지원하지 않는 필드입니다: ${unknown.join(", ")}` };

  const fields = {};
  const value = {
    category: cleanString(input.category),
    title: cleanString(input.title),
    link: cleanString(input.link),
    amountKrw: input.amountKrw,
    startMonth: input.startMonth,
    endMonth: input.endMonth,
    target: formatCatalogBulletText(input.target),
    details: formatCatalogBulletText(input.details),
    industries: cleanTags(input.industries, options.industries, "industries", fields),
    regions: cleanTags(input.regions, options.regions, "regions", fields),
    mainPackage: input.mainPackage ?? false,
  };

  if (!CATALOG_CATEGORIES.has(value.category)) fields.category = "사업 카탈로그에서 지원하지 않는 구분입니다.";
  if (!value.title || value.title.length > 240) fields.title = "사업명은 1~240자로 입력해 주세요.";
  try {
    const url = new URL(value.link);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol");
    if (value.link.length > 2048) throw new Error("length");
  } catch {
    fields.link = "http 또는 https 링크를 입력해 주세요.";
  }
  if (value.amountKrw !== null && (!Number.isSafeInteger(value.amountKrw) || value.amountKrw <= 0)) {
    fields.amountKrw = "지원금액은 비워 두거나 1원 이상의 정수로 입력해 주세요.";
  }
  if (!Number.isInteger(value.startMonth) || !Number.isInteger(value.endMonth)
    || value.startMonth < 1 || value.endMonth > 12 || value.startMonth > value.endMonth) {
    fields.startMonth = "지원기간은 1~12월 안에서 시작월이 종료월보다 늦지 않아야 합니다.";
    fields.endMonth = fields.startMonth;
  }
  if (!value.target || value.target.length > 1000) fields.target = "지원대상은 1~1,000자로 입력해 주세요.";
  if (!value.details || value.details.length > 4000) fields.details = "지원내용은 1~4,000자로 입력해 주세요.";
  if (value.industries.length !== 1) fields.industries = "업종은 하나만 선택해 주세요.";
  if (typeof value.mainPackage !== "boolean") fields.mainPackage = "메인패키지 지정 여부를 확인해 주세요.";
  if (value.category !== "business" && value.mainPackage) fields.mainPackage = "메인패키지는 사업화 사업에만 지정할 수 있습니다.";

  value.businessSubcategories = inferBusinessSubcategories(value);

  return Object.keys(fields).length ? { error: "입력 내용을 확인해 주세요.", fields } : { value };
}

async function catalogOptionSets(db) {
  const industries = new Set(INDUSTRY_OPTIONS);
  const regions = new Set(REGION_OPTIONS);
  const rows = await db.prepare("SELECT kind, value FROM catalog_options ORDER BY kind, value").bind().all();
  for (const row of rows.results ?? []) if (row.kind === "region" && !INVALID_REGIONS.has(row.value)) regions.add(row.value);
  return { industries, regions };
}

async function listCatalogOptions(db) {
  const options = await catalogOptionSets(db);
  return json({
    industries: [...options.industries].sort(),
    regions: [...options.regions].sort(),
  });
}

async function createCatalogOption(request, db) {
  const body = await readBody(request);
  if (body.error) return apiError(body.status ?? 400, body.error);
  const input = body.value;
  const kind = input?.kind;
  const value = cleanString(input?.value);
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => key !== "kind" && key !== "value")
    || !OPTION_KINDS.has(kind) || value.length < 1 || value.length > 100) {
    return apiError(400, "공용 선택지를 확인해 주세요.");
  }
  if (kind === "industry" && NON_INDUSTRIES.has(value)) {
    return apiError(400, "업종이 아닌 범용 태그는 추가할 수 없습니다.");
  }
  if (kind === "region" && INVALID_REGIONS.has(value)) {
    return apiError(400, "잘못 축약된 지역 태그는 추가할 수 없습니다.");
  }
  if ((kind === "industry" ? INDUSTRIES : REGIONS).has(value)) {
    return json({ item: { kind, value }, created: false });
  }
  const result = await db.prepare("INSERT OR IGNORE INTO catalog_options (kind, value, created_at) VALUES (?, ?, ?)")
    .bind(kind, value, new Date().toISOString())
    .run();
  const created = !!result.meta?.changes;
  return json({ item: { kind, value }, created }, created ? 201 : 200);
}

function boundedString(value, maxLength) {
  return typeof value === "string" && value.length <= maxLength;
}

function draftNumber(value) {
  return value === "" || Number.isSafeInteger(value);
}

export function validateRoadmapDocumentForStorage(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "로드맵을 JSON 객체로 입력해 주세요." };
  }

  const unknown = Object.keys(input).filter((key) => !ROADMAP_FIELDS.has(key));
  if (!ROADMAP_TIERS.has(input.tier)) return { error: "ROADMAP_TIER_REQUIRED" };
  if (unknown.length) return { error: `지원하지 않는 필드입니다: ${unknown.join(", ")}` };
  if (!boundedString(input.clientName, 240)) return { error: "클라이언트명은 240자 이하의 문자열이어야 합니다." };
  if (!Array.isArray(input.programs) || input.programs.length > MAX_ROADMAP_PROGRAMS) {
    return { error: `로드맵 사업은 ${MAX_ROADMAP_PROGRAMS}개 이하의 배열이어야 합니다.` };
  }

  const forbiddenStandardCategoryIndex = input.tier === "standard"
    ? input.programs.findIndex((program) => CATEGORIES.has(program?.category) && !STANDARD_ROADMAP_CATEGORIES.has(program.category))
    : -1;
  if (forbiddenStandardCategoryIndex !== -1) {
    return { error: `programs[${forbiddenStandardCategoryIndex}].category is not supported for the standard roadmap tier.` };
  }

  for (const [index, program] of input.programs.entries()) {
    if (!program || typeof program !== "object" || Array.isArray(program)) {
      return { error: `programs[${index}]은 객체여야 합니다.` };
    }
    const unknownProgramFields = Object.keys(program).filter((key) => !ROADMAP_PROGRAM_FIELDS.has(key));
    if (unknownProgramFields.length) {
      return { error: `programs[${index}]에 지원하지 않는 필드가 있습니다: ${unknownProgramFields.join(", ")}` };
    }
    if (!boundedString(program.id, 100) || !/^[A-Za-z0-9_-]+$/.test(program.id)) {
      return { error: `programs[${index}].id 형식이 올바르지 않습니다.` };
    }
    if (!CATEGORIES.has(program.category)) return { error: `programs[${index}].category가 올바르지 않습니다.` };
    if (program.displayCategory !== undefined && (program.category !== "business" || program.displayCategory !== "marketing")) {
      return { error: `programs[${index}].displayCategory가 올바르지 않습니다.` };
    }
    if (!boundedString(program.title, 240)) return { error: `programs[${index}].title은 240자 이하여야 합니다.` };
    if (program.link !== undefined && !boundedString(program.link, 2048)) return { error: `programs[${index}].link가 올바르지 않습니다.` };
    if (program.link) {
      try {
        if (!["http:", "https:"].includes(new URL(program.link).protocol)) throw new Error("protocol");
      } catch {
        return { error: `programs[${index}].link가 올바르지 않습니다.` };
      }
    }
    if (program.target !== undefined && !boundedString(program.target, 1000)) return { error: `programs[${index}].target이 올바르지 않습니다.` };
    if (program.details !== undefined && !boundedString(program.details, 4000)) return { error: `programs[${index}].details가 올바르지 않습니다.` };
    if (!draftNumber(program.startMonth) || !draftNumber(program.endMonth)) return { error: `programs[${index}]의 기간이 올바르지 않습니다.` };
    if (program.amountKrw !== null && !Number.isSafeInteger(program.amountKrw)) {
      return { error: `programs[${index}].amountKrw가 올바르지 않습니다.` };
    }
    if (!Number.isSafeInteger(program.sequence)) return { error: `programs[${index}].sequence가 올바르지 않습니다.` };
    if (program.laneIndex !== undefined && !Number.isSafeInteger(program.laneIndex)) {
      return { error: `programs[${index}].laneIndex가 올바르지 않습니다.` };
    }
  }

  return { value: input };
}

function rowToProgram(row) {
  const program = {
    id: row.id,
    category: row.category,
    title: row.title,
    link: row.link,
    amountKrw: row.amountKrw,
    startMonth: row.startMonth,
    endMonth: row.endMonth,
    target: row.target,
    details: row.details,
    industries: JSON.parse(row.industriesJson),
    regions: JSON.parse(row.regionsJson),
    mainPackage: row.mainPackage === 1 || row.mainPackage === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return { ...program, businessSubcategories: inferBusinessSubcategories(program) };
}

const SELECT_FIELDS = `
  id, category, title, link,
  amount_krw AS amountKrw,
  start_month AS startMonth,
  end_month AS endMonth,
  target, details,
  industries_json AS industriesJson,
  regions_json AS regionsJson,
  main_package AS mainPackage,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

async function listCatalog(request, db) {
  const url = new URL(request.url);
  const q = cleanString(url.searchParams.get("q")).slice(0, 100);
  const category = cleanString(url.searchParams.get("category"));
  const startMonthText = cleanString(url.searchParams.get("startMonth"));
  const endMonthText = cleanString(url.searchParams.get("endMonth"));
  const industries = [...new Set(url.searchParams.getAll("industry").map(cleanString).filter(Boolean))];
  const regions = [...new Set(url.searchParams.getAll("region").map(cleanString).filter(Boolean))];
  const businessSubcategories = [...new Set(url.searchParams.getAll("businessSubcategory").map(cleanString).filter(Boolean))];
  if (industries.length > 20 || regions.length > 20 || industries.some((item) => item.length > 100) || regions.some((item) => item.length > 100)) {
    return apiError(400, "카탈로그 필터를 확인해 주세요.");
  }
  if (businessSubcategories.some((tag) => !BUSINESS_SUBCATEGORIES.has(tag))) {
    return apiError(400, "사업화 세부 분류를 확인해 주세요.");
  }
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  const requestedOffset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
  const offset = Number.isInteger(requestedOffset) ? Math.min(Math.max(requestedOffset, 0), 100_000) : 0;
  const filters = [];
  const searchParams = [];
  const startMonth = startMonthText ? Number.parseInt(startMonthText, 10) : null;
  const endMonth = endMonthText ? Number.parseInt(endMonthText, 10) : null;
  if (category && !CATALOG_CATEGORIES.has(category)) {
    return apiError(400, "사업 카탈로그에서 지원하지 않는 구분입니다.");
  }
  if ((startMonthText && (!Number.isInteger(startMonth) || String(startMonth) !== startMonthText || startMonth < 1 || startMonth > 12))
    || (endMonthText && (!Number.isInteger(endMonth) || String(endMonth) !== endMonthText || endMonth < 1 || endMonth > 12))
    || (startMonth !== null && endMonth !== null && startMonth > endMonth)) {
    return apiError(400, "카탈로그 필터를 확인해 주세요.");
  }
  if (q) {
    filters.push("(title LIKE ? OR target LIKE ? OR details LIKE ?)");
    searchParams.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (CATALOG_CATEGORIES.has(category)) {
    filters.push("category = ?");
    searchParams.push(category);
  }
  if (startMonth !== null || endMonth !== null) {
    filters.push("start_month <= ? AND end_month >= ?");
    searchParams.push(endMonth ?? 12, startMonth ?? 1);
  }
  if (businessSubcategories.length && category !== "business") {
    return apiError(400, "사업화 세부 분류는 사업화 구분에서만 사용할 수 있습니다.");
  }
  if (industries.length) {
    filters.push(`EXISTS (SELECT 1 FROM json_each(industries_json) WHERE value IN (${industries.map(() => "?").join(", ")}))`);
    searchParams.push(...industries);
  }
  if (regions.length) {
    filters.push(`EXISTS (SELECT 1 FROM json_each(regions_json) WHERE value IN (${regions.map(() => "?").join(", ")}))`);
    searchParams.push(...regions);
  }
  if (businessSubcategories.length) {
    const predicates = businessSubcategories.map((tag) => {
      if (tag === "메인패키지") return "main_package = 1 /* business-subcategory:메인패키지 */";
      const terms = tag === "경진대회"
        ? BUSINESS_COMPETITION_TERMS
        : tag === "수출" ? ["수출", ...FOREIGN_COUNTRY_NAMES] : [tag];
      const columns = tag === "경진대회" ? ["title"] : ["title", "details"];
      searchParams.push(JSON.stringify(terms));
      return `EXISTS (SELECT 1 FROM json_each(?) AS business_term WHERE ${columns.map((column) => `instr(${column}, business_term.value) > 0`).join(" OR ")}) /* business-subcategory:${tag} */`;
    });
    filters.push(`(${predicates.join(" OR ")})`);
  }
  const searchSql = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
  const periodOrder = startMonth !== null || endMonth !== null
    ? `CASE WHEN start_month = ? AND end_month = ? THEN 0
            WHEN start_month <= ? AND end_month >= ? THEN 1
            ELSE 2 END,
         CASE WHEN start_month <= ? AND end_month >= ?
              THEN (? - start_month) + (end_month - ?)
              ELSE 999 END,`
    : "";
  const periodOrderParams = startMonth !== null || endMonth !== null
    ? [startMonth ?? 1, endMonth ?? 12, startMonth ?? 1, endMonth ?? 12, startMonth ?? 1, endMonth ?? 12, startMonth ?? 1, endMonth ?? 12]
    : [];

  const [page, count] = await Promise.all([
    db.prepare(`SELECT ${SELECT_FIELDS} FROM catalog_programs${searchSql} ORDER BY ${periodOrder} updated_at DESC, id DESC LIMIT ? OFFSET ?`)
      .bind(...searchParams, ...periodOrderParams, limit, offset)
      .all(),
    db.prepare(`SELECT COUNT(*) AS total FROM catalog_programs${searchSql}`)
      .bind(...searchParams)
      .first(),
  ]);

  return json({ items: (page.results ?? []).map(rowToProgram), total: count?.total ?? 0, limit, offset });
}

async function readBody(request) {
  try {
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return { error: "요청 데이터가 너무 큽니다.", status: 413 };
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
      return { error: "요청 데이터가 너무 큽니다.", status: 413 };
    }
    return { value: JSON.parse(text) };
  } catch {
    return { error: "올바른 JSON 요청이 아닙니다." };
  }
}

async function createCatalog(request, db) {
  const body = await readBody(request);
  if (body.error) return apiError(body.status ?? 400, body.error);
  const validated = validateCatalogProgramWithOptions(body.value, await catalogOptionSets(db));
  if (validated.error) return apiError(400, validated.error, validated.fields);

  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const item = { id, ...validated.value, createdAt: timestamp, updatedAt: timestamp };
  await db.prepare(`
    INSERT INTO catalog_programs
      (id, category, title, link, amount_krw, start_month, end_month, target, details,
       industries_json, regions_json, main_package, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, item.category, item.title, item.link, item.amountKrw, item.startMonth, item.endMonth,
    item.target, item.details, JSON.stringify(item.industries), JSON.stringify(item.regions), item.mainPackage ? 1 : 0, timestamp, timestamp).run();
  return json({ item }, 201);
}

async function updateCatalog(request, db, id) {
  const body = await readBody(request);
  if (body.error) return apiError(body.status ?? 400, body.error);
  const validated = validateCatalogProgramWithOptions(body.value, await catalogOptionSets(db));
  if (validated.error) return apiError(400, validated.error, validated.fields);

  const timestamp = new Date().toISOString();
  const item = { id, ...validated.value, updatedAt: timestamp };
  const result = await db.prepare(`
    UPDATE catalog_programs
    SET category = ?, title = ?, link = ?, amount_krw = ?, start_month = ?, end_month = ?,
        target = ?, details = ?, industries_json = ?, regions_json = ?, main_package = ?, updated_at = ?
    WHERE id = ?
  `).bind(item.category, item.title, item.link, item.amountKrw, item.startMonth, item.endMonth,
    item.target, item.details, JSON.stringify(item.industries), JSON.stringify(item.regions), item.mainPackage ? 1 : 0, timestamp, id).run();
  if (!result.meta?.changes) return apiError(404, "등록된 사업을 찾을 수 없습니다.");
  return json({ item });
}

async function deleteCatalog(db, id) {
  const result = await db.prepare("DELETE FROM catalog_programs WHERE id = ?").bind(id).run();
  if (!result.meta?.changes) return apiError(404, "등록된 사업을 찾을 수 없습니다.");
  return json({ deleted: true, id });
}

const ROADMAP_SELECT_FIELDS = `
  id,
  tier,
  client_name AS clientName,
  document_json AS documentJson,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

async function listRoadmaps(request, db) {
  const url = new URL(request.url);
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  const requestedOffset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
  const offset = Number.isInteger(requestedOffset) ? Math.min(Math.max(requestedOffset, 0), 100_000) : 0;
  const [page, count] = await Promise.all([
    db.prepare(`SELECT id, tier, client_name AS clientName, created_at AS createdAt, updated_at AS updatedAt
      FROM roadmaps ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`).bind(limit, offset).all(),
    db.prepare("SELECT COUNT(*) AS total FROM roadmaps").bind().first(),
  ]);
  return json({ items: page.results ?? [], total: count?.total ?? 0, limit, offset });
}

function documentFromStoredRow(row) {
  if (!ROADMAP_TIERS.has(row.tier)) return { error: "ROADMAP_TIER_DATA_INTEGRITY" };
  const tier = row.tier;
  const document = JSON.parse(row.documentJson);
  if (document?.tier === undefined) return { document: { ...document, tier } };
  if (ROADMAP_TIERS.has(document.tier) && document.tier !== tier) {
    return { error: "ROADMAP_TIER_DATA_INTEGRITY" };
  }
  if (!ROADMAP_TIERS.has(document.tier)) {
    return { error: "ROADMAP_TIER_DATA_INTEGRITY" };
  }
  return { document };
}

async function getRoadmap(db, id) {
  const row = await db.prepare(`SELECT ${ROADMAP_SELECT_FIELDS} FROM roadmaps WHERE id = ?`).bind(id).first();
  if (!row) return apiError(404, "저장된 로드맵을 찾을 수 없습니다.");
  try {
    const stored = documentFromStoredRow(row);
    if (stored.error) return apiError(500, stored.error);
    return json({ item: { id: row.id, tier: row.tier, clientName: row.clientName, document: stored.document, createdAt: row.createdAt, updatedAt: row.updatedAt } });
  } catch {
    return apiError(500, "저장된 로드맵 데이터를 읽지 못했습니다.");
  }
}

async function createRoadmap(request, db) {
  const body = await readBody(request);
  if (body.error) return apiError(body.status ?? 400, body.error);
  const validated = validateRoadmapDocumentForStorage(body.value);
  if (validated.error) return apiError(400, validated.error);

  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await db.prepare(`INSERT INTO roadmaps (id, tier, client_name, document_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, validated.value.tier, validated.value.clientName, JSON.stringify(validated.value), timestamp, timestamp)
    .run();
  return json({ item: { id, tier: validated.value.tier, clientName: validated.value.clientName, document: validated.value, createdAt: timestamp, updatedAt: timestamp } }, 201);
}

async function updateRoadmap(request, db, id) {
  const body = await readBody(request);
  if (body.error) return apiError(body.status ?? 400, body.error);
  const validated = validateRoadmapDocumentForStorage(body.value);
  if (validated.error) return apiError(400, validated.error);

  const existing = await db.prepare("SELECT tier FROM roadmaps WHERE id = ?").bind(id).first();
  if (!existing) return apiError(404, "ROADMAP_NOT_FOUND");
  if (existing.tier !== validated.value.tier) return apiError(409, "ROADMAP_TIER_IMMUTABLE");

  const timestamp = new Date().toISOString();
  const updateStatement = db.prepare(`UPDATE roadmaps
    SET client_name = ?, document_json = ?, updated_at = ? WHERE id = ?`)
    .bind(validated.value.clientName, JSON.stringify(validated.value), timestamp, id);
  const cleanupStatement = await removedProgramFeedbackStatement(db, id, validated.value.programs.map((program) => program.id));
  const [result] = cleanupStatement
    ? await db.batch([updateStatement, cleanupStatement])
    : [await updateStatement.run()];
  if (!result.meta?.changes) return apiError(404, "저장된 로드맵을 찾을 수 없습니다.");
  return json({ item: { id, tier: existing.tier, clientName: validated.value.clientName, document: validated.value, updatedAt: timestamp } });
}

async function removedProgramFeedbackStatement(db, roadmapId, programIds) {
  try {
    const table = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'roadmap_feedback'").bind().first();
    if (!table) return null;
    if (!programIds.length) {
      return db.prepare("DELETE FROM roadmap_feedback WHERE roadmap_id = ?").bind(roadmapId);
    }
    const placeholders = programIds.map(() => "?").join(", ");
    return db.prepare(`DELETE FROM roadmap_feedback WHERE roadmap_id = ? AND program_id NOT IN (${placeholders})`)
      .bind(roadmapId, ...programIds);
  } catch (error) {
    const message = String(error?.message ?? error);
    if (!message.includes("no such table") && !message.includes("Unsupported statement")) throw error;
    return null;
  }
}

async function deleteRoadmap(db, id) {
  const feedbackTable = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'roadmap_feedback'").bind().first();
  const deleteRoadmapStatement = db.prepare("DELETE FROM roadmaps WHERE id = ?").bind(id);
  const results = feedbackTable
    ? await db.batch([db.prepare("DELETE FROM roadmap_feedback WHERE roadmap_id = ?").bind(id), deleteRoadmapStatement])
    : [await deleteRoadmapStatement.run()];
  const result = feedbackTable ? results[1] : results[0];
  if (!result.meta?.changes) return apiError(404, "저장된 로드맵을 찾을 수 없습니다.");
  return json({ deleted: true, id });
}

async function roadmapProgramExists(db, roadmapId, programId) {
  const row = await db.prepare("SELECT tier, document_json AS documentJson FROM roadmaps WHERE id = ?").bind(roadmapId).first();
  if (!row) return { error: apiError(404, "ROADMAP_NOT_FOUND") };
  try {
    const stored = documentFromStoredRow(row);
    if (stored.error) return { error: apiError(500, stored.error) };
    const program = stored.document?.programs?.find((item) => item?.id === programId);
    if (!program) return { error: apiError(404, "ROADMAP_PROGRAM_NOT_FOUND") };
    return { program };
  } catch {
    return { error: apiError(500, "ROADMAP_DOCUMENT_UNREADABLE") };
  }
}

function rowToFeedbackEvent(row) {
  return {
    id: row.id,
    type: row.type,
    role: row.role,
    text: row.text,
    createdAt: row.createdAt,
  };
}

function rowsToFeedbackItems(feedbackRows, eventRows) {
  const eventsByFeedbackId = new Map();
  for (const row of eventRows) {
    const events = eventsByFeedbackId.get(row.feedbackId) ?? [];
    events.push(rowToFeedbackEvent(row));
    eventsByFeedbackId.set(row.feedbackId, events);
  }
  return feedbackRows.map((row) => ({
    id: row.id,
    programId: row.programId,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    events: eventsByFeedbackId.get(row.id) ?? [],
  }));
}

async function feedbackItem(db, roadmapId, programId) {
  const row = await db.prepare(`SELECT id, program_id AS programId, status, created_at AS createdAt, updated_at AS updatedAt
    FROM roadmap_feedback WHERE roadmap_id = ? AND program_id = ?`)
    .bind(roadmapId, programId)
    .first();
  if (!row) return null;
  const events = await db.prepare(`SELECT id, feedback_id AS feedbackId, type, role, text, created_at AS createdAt
    FROM roadmap_feedback_events WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`)
    .bind(row.id)
    .all();
  return rowsToFeedbackItems([row], events.results ?? [])[0];
}

async function listFeedback(db, roadmapId) {
  const row = await db.prepare("SELECT tier, document_json AS documentJson FROM roadmaps WHERE id = ?").bind(roadmapId).first();
  if (!row) return apiError(404, "ROADMAP_NOT_FOUND");
  let programIds;
  try {
    const stored = documentFromStoredRow(row);
    if (stored.error) return apiError(500, stored.error);
    programIds = new Set((stored.document?.programs ?? []).map((program) => program?.id).filter(Boolean));
  } catch {
    return apiError(500, "ROADMAP_DOCUMENT_UNREADABLE");
  }
  const feedback = await db.prepare(`SELECT id, program_id AS programId, status, created_at AS createdAt, updated_at AS updatedAt
    FROM roadmap_feedback WHERE roadmap_id = ? ORDER BY updated_at DESC, id DESC`)
    .bind(roadmapId)
    .all();
  const feedbackRows = (feedback.results ?? []).filter((item) => programIds.has(item.programId));
  if (!feedbackRows.length) return json({ items: [] });
  const placeholders = feedbackRows.map(() => "?").join(", ");
  const events = await db.prepare(`SELECT id, feedback_id AS feedbackId, type, role, text, created_at AS createdAt
    FROM roadmap_feedback_events WHERE feedback_id IN (${placeholders}) ORDER BY created_at ASC, id ASC`)
    .bind(...feedbackRows.map((item) => item.id))
    .all();
  return json({ items: rowsToFeedbackItems(feedbackRows, events.results ?? []) });
}

async function createFeedback(request, env, roadmapId) {
  const actionHeaderError = requireFeedbackActionHeader(request);
  if (actionHeaderError) return actionHeaderError;
  const authError = await requireLeadSession(request, env);
  if (authError) return authError;
  if (!isJsonRequest(request)) return apiError(415, "JSON_CONTENT_TYPE_REQUIRED");
  const body = await readBody(request);
  if (body.error) return apiError(body.status ?? 400, body.error);
  if (!hasOnlyFields(body.value, new Set(["programId", "text"]))) return apiError(400, "FEEDBACK_INPUT_INVALID");
  const programId = cleanString(body.value?.programId);
  const text = cleanFeedbackText(body.value?.text);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(programId) || !text) return apiError(400, "FEEDBACK_INPUT_INVALID");
  const exists = await roadmapProgramExists(env.DB, roadmapId, programId);
  if (exists.error) return exists.error;

  const now = new Date().toISOString();
  const existing = await env.DB.prepare("SELECT id FROM roadmap_feedback WHERE roadmap_id = ? AND program_id = ?")
    .bind(roadmapId, programId)
    .first();
  if (existing) return apiError(409, "FEEDBACK_ALREADY_EXISTS");
  const feedbackId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO roadmap_feedback (id, roadmap_id, program_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(feedbackId, roadmapId, programId, "needs_changes", now, now),
    env.DB.prepare(`INSERT INTO roadmap_feedback_events (id, feedback_id, type, role, text, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), feedbackId, "comment", "lead", text, now),
  ]);
  return json({ item: await feedbackItem(env.DB, roadmapId, programId) }, 201);
}

async function updateFeedback(request, env, roadmapId, programId) {
  const actionHeaderError = requireFeedbackActionHeader(request);
  if (actionHeaderError) return actionHeaderError;
  if (!isJsonRequest(request)) return apiError(415, "JSON_CONTENT_TYPE_REQUIRED");
  const body = await readBody(request);
  if (body.error) return apiError(body.status ?? 400, body.error);
  if (!hasOnlyFields(body.value, new Set(["action", "text"]))) return apiError(400, "FEEDBACK_INPUT_INVALID");
  const action = body.value?.action;
  const text = body.value?.text === undefined ? "" : cleanFeedbackText(body.value.text);
  if (!FEEDBACK_ACTIONS.has(action)
    || (body.value?.text !== undefined && !text)
    || (action === "rework" && !text)) {
    return apiError(400, "FEEDBACK_INPUT_INVALID");
  }
  if (action !== "complete") {
    const authError = await requireLeadSession(request, env);
    if (authError) return authError;
  }
  const exists = await roadmapProgramExists(env.DB, roadmapId, programId);
  if (exists.error) return exists.error;
  const row = await env.DB.prepare("SELECT id, status, updated_at AS updatedAt FROM roadmap_feedback WHERE roadmap_id = ? AND program_id = ?")
    .bind(roadmapId, programId)
    .first();
  if (!row) return apiError(404, "FEEDBACK_NOT_FOUND");
  const validTransition = action === "complete"
    ? row.status === "needs_changes"
    : row.status === "completed";
  if (!validTransition) return apiError(409, "FEEDBACK_STATE_CONFLICT");

  const nextStatus = action === "complete" ? "completed" : action === "resolve" ? "resolved" : "needs_changes";
  const type = action === "complete" ? "completed" : action === "resolve" ? "resolved" : "rework";
  const role = action === "complete" ? "assignee" : "lead";
  const previousTimestamp = Date.parse(row.updatedAt);
  const now = new Date(Math.max(Date.now(), Number.isFinite(previousTimestamp) ? previousTimestamp + 1 : 0)).toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE roadmap_feedback SET status = ?, updated_at = ? WHERE id = ?")
      .bind(nextStatus, now, row.id),
    env.DB.prepare(`INSERT INTO roadmap_feedback_events (id, feedback_id, type, role, text, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), row.id, type, role, text, now),
  ]);
  return json({ item: await feedbackItem(env.DB, roadmapId, programId) });
}

async function handleApi(request, env, pathname) {
  if (!pathname.startsWith("/api/")) return null;
  const isCatalog = pathname === CATALOG_PATH || pathname.startsWith(`${CATALOG_PATH}/`);
  const isCatalogOptions = pathname === CATALOG_OPTIONS_PATH;
  const isFeedbackAuth = pathname === FEEDBACK_AUTH_PATH;
  const isRoadmap = pathname === ROADMAP_PATH || pathname.startsWith(`${ROADMAP_PATH}/`);
  const feedback = isRoadmap ? feedbackPath(pathname) : null;
  if (!isCatalog && !isCatalogOptions && !isFeedbackAuth && !isRoadmap) {
    return apiError(404, "API 경로를 찾을 수 없습니다.");
  }
  if (!env.DB) return apiError(503, "공유 저장소를 사용할 수 없습니다.");

  if ((["POST", "PUT"].includes(request.method) || (request.method === "PATCH" && feedback))
    && !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return apiError(415, "JSON 형식으로 요청해 주세요.");
  }

  if (isFeedbackAuth) {
    try {
      return await handleFeedbackAuth(request, env);
    } catch (error) {
      console.error("api error", error);
      return apiError(500, "FEEDBACK_AUTH_ERROR");
    }
  }

  if (feedback) {
    try {
      if (!feedback.programId && request.method === "GET") return listFeedback(env.DB, feedback.roadmapId);
      if (!feedback.programId && request.method === "POST") return createFeedback(request, env, feedback.roadmapId);
      if (feedback.programId && request.method === "PATCH") return updateFeedback(request, env, feedback.roadmapId, feedback.programId);
      return apiError(405, "UNSUPPORTED_METHOD");
    } catch (error) {
      console.error("api error", error);
      return apiError(500, "FEEDBACK_ERROR");
    }
  }

  if (isRoadmap && pathname.includes("/feedback")) return apiError(404, "FEEDBACK_PATH_NOT_FOUND");

  if (isCatalogOptions) {
    try {
      if (request.method === "GET") return listCatalogOptions(env.DB);
      if (request.method === "POST") return createCatalogOption(request, env.DB);
      return apiError(405, "지원하지 않는 요청 방식입니다.");
    } catch (error) {
      console.error("api error", error);
      return apiError(500, "공용 선택지 요청을 처리하지 못했습니다.");
    }
  }

  const basePath = isCatalog ? CATALOG_PATH : ROADMAP_PATH;
  const id = pathname === basePath ? null : resourceId(pathname, basePath);
  if (id === "" || (pathname !== basePath && id === null)) return apiError(404, "저장된 항목을 찾을 수 없습니다.");

  try {
    if (isCatalog && pathname === CATALOG_PATH && request.method === "GET") return listCatalog(request, env.DB);
    if (isCatalog && pathname === CATALOG_PATH && request.method === "POST") return createCatalog(request, env.DB);
    if (isCatalog && id && request.method === "PUT") return updateCatalog(request, env.DB, id);
    if (isCatalog && id && request.method === "DELETE") return deleteCatalog(env.DB, id);
    if (isRoadmap && pathname === ROADMAP_PATH && request.method === "GET") return listRoadmaps(request, env.DB);
    if (isRoadmap && pathname === ROADMAP_PATH && request.method === "POST") return createRoadmap(request, env.DB);
    if (isRoadmap && id && request.method === "GET") return getRoadmap(env.DB, id);
    if (isRoadmap && id && request.method === "PUT") return updateRoadmap(request, env.DB, id);
    if (isRoadmap && id && request.method === "DELETE") return deleteRoadmap(env.DB, id);
    return apiError(405, "지원하지 않는 요청 방식입니다.");
  } catch (error) {
    console.error("api error", error);
    return apiError(500, isCatalog ? "사업 카탈로그 요청을 처리하지 못했습니다." : "로드맵 요청을 처리하지 못했습니다.");
  }
}

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    const apiResponse = await handleApi(request, env, pathname);
    if (apiResponse) return apiResponse;

    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");

    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
      return response;
    }

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
