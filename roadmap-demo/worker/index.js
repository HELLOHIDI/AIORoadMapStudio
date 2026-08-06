import { INDUSTRY_OPTIONS, REGION_OPTIONS } from "../catalog-options.js";

const CATALOG_PATH = "/api/catalog-programs";
const ROADMAP_PATH = "/api/roadmaps";
const CATEGORIES = new Set(["consulting", "business", "voucher", "ip", "certification"]);
const FIELDS = new Set(["category", "title", "link", "amountKrw", "startMonth", "endMonth", "target", "details", "industries", "regions"]);
const ROADMAP_FIELDS = new Set(["clientName", "programs"]);
const ROADMAP_PROGRAM_FIELDS = new Set(["id", "category", "title", "link", "amountKrw", "startMonth", "endMonth", "target", "details", "sequence", "laneIndex"]);
const INDUSTRIES = new Set(INDUSTRY_OPTIONS);
const REGIONS = new Set(REGION_OPTIONS);
const MAX_BODY_BYTES = 500_000;
const MAX_ROADMAP_PROGRAMS = 500;

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
    target: cleanString(input.target),
    details: cleanString(input.details),
    industries: cleanTags(input.industries, INDUSTRIES, "industries", fields),
    regions: cleanTags(input.regions, REGIONS, "regions", fields),
  };

  if (!CATEGORIES.has(value.category)) fields.category = "지원하지 않는 구분입니다.";
  if (!value.title || value.title.length > 240) fields.title = "사업명은 1~240자로 입력해 주세요.";
  try {
    const url = new URL(value.link);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol");
    if (value.link.length > 2048) throw new Error("length");
  } catch {
    fields.link = "http 또는 https 링크를 입력해 주세요.";
  }
  if (value.amountKrw !== null && (!Number.isSafeInteger(value.amountKrw) || value.amountKrw < 1_000_000)) {
    fields.amountKrw = "지원금액은 비워 두거나 100만원 이상의 정수로 입력해 주세요.";
  }
  if (!Number.isInteger(value.startMonth) || !Number.isInteger(value.endMonth)
    || value.startMonth < 1 || value.endMonth > 12 || value.startMonth > value.endMonth) {
    fields.startMonth = "지원기간은 1~12월 안에서 시작월이 종료월보다 늦지 않아야 합니다.";
    fields.endMonth = fields.startMonth;
  }
  if (!value.target || value.target.length > 1000) fields.target = "지원대상은 1~1,000자로 입력해 주세요.";
  if (!value.details || value.details.length > 4000) fields.details = "지원내용은 1~4,000자로 입력해 주세요.";

  return Object.keys(fields).length ? { error: "입력 내용을 확인해 주세요.", fields } : { value };
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
  if (unknown.length) return { error: `지원하지 않는 필드입니다: ${unknown.join(", ")}` };
  if (!boundedString(input.clientName, 240)) return { error: "클라이언트명은 240자 이하의 문자열이어야 합니다." };
  if (!Array.isArray(input.programs) || input.programs.length > MAX_ROADMAP_PROGRAMS) {
    return { error: `로드맵 사업은 ${MAX_ROADMAP_PROGRAMS}개 이하의 배열이어야 합니다.` };
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
    if (!boundedString(program.title, 240)) return { error: `programs[${index}].title은 240자 이하여야 합니다.` };
    if (program.link !== undefined && !boundedString(program.link, 2048)) return { error: `programs[${index}].link가 올바르지 않습니다.` };
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
  return {
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const SELECT_FIELDS = `
  id, category, title, link,
  amount_krw AS amountKrw,
  start_month AS startMonth,
  end_month AS endMonth,
  target, details,
  industries_json AS industriesJson,
  regions_json AS regionsJson,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

async function listCatalog(request, db) {
  const url = new URL(request.url);
  const q = cleanString(url.searchParams.get("q")).slice(0, 100);
  const category = cleanString(url.searchParams.get("category"));
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  const requestedOffset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
  const offset = Number.isInteger(requestedOffset) ? Math.min(Math.max(requestedOffset, 0), 100_000) : 0;
  const filters = [];
  const searchParams = [];
  if (q) {
    filters.push("(title LIKE ? OR target LIKE ? OR details LIKE ?)");
    searchParams.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (CATEGORIES.has(category)) {
    filters.push("category = ?");
    searchParams.push(category);
  }
  const searchSql = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";

  const [page, count] = await Promise.all([
    db.prepare(`SELECT ${SELECT_FIELDS} FROM catalog_programs${searchSql} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`)
      .bind(...searchParams, limit, offset)
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
  const validated = validateCatalogProgram(body.value);
  if (validated.error) return apiError(400, validated.error, validated.fields);

  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const item = { id, ...validated.value, createdAt: timestamp, updatedAt: timestamp };
  await db.prepare(`
    INSERT INTO catalog_programs
      (id, category, title, link, amount_krw, start_month, end_month, target, details,
       industries_json, regions_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, item.category, item.title, item.link, item.amountKrw, item.startMonth, item.endMonth,
    item.target, item.details, JSON.stringify(item.industries), JSON.stringify(item.regions), timestamp, timestamp).run();
  return json({ item }, 201);
}

async function updateCatalog(request, db, id) {
  const body = await readBody(request);
  if (body.error) return apiError(body.status ?? 400, body.error);
  const validated = validateCatalogProgram(body.value);
  if (validated.error) return apiError(400, validated.error, validated.fields);

  const timestamp = new Date().toISOString();
  const item = { id, ...validated.value, updatedAt: timestamp };
  const result = await db.prepare(`
    UPDATE catalog_programs
    SET category = ?, title = ?, link = ?, amount_krw = ?, start_month = ?, end_month = ?,
        target = ?, details = ?, industries_json = ?, regions_json = ?, updated_at = ?
    WHERE id = ?
  `).bind(item.category, item.title, item.link, item.amountKrw, item.startMonth, item.endMonth,
    item.target, item.details, JSON.stringify(item.industries), JSON.stringify(item.regions), timestamp, id).run();
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
    db.prepare(`SELECT id, client_name AS clientName, created_at AS createdAt, updated_at AS updatedAt
      FROM roadmaps ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`).bind(limit, offset).all(),
    db.prepare("SELECT COUNT(*) AS total FROM roadmaps").bind().first(),
  ]);
  return json({ items: page.results ?? [], total: count?.total ?? 0, limit, offset });
}

async function getRoadmap(db, id) {
  const row = await db.prepare(`SELECT ${ROADMAP_SELECT_FIELDS} FROM roadmaps WHERE id = ?`).bind(id).first();
  if (!row) return apiError(404, "저장된 로드맵을 찾을 수 없습니다.");
  try {
    return json({ item: { id: row.id, clientName: row.clientName, document: JSON.parse(row.documentJson), createdAt: row.createdAt, updatedAt: row.updatedAt } });
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
  await db.prepare(`INSERT INTO roadmaps (id, client_name, document_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)`)
    .bind(id, validated.value.clientName, JSON.stringify(validated.value), timestamp, timestamp)
    .run();
  return json({ item: { id, clientName: validated.value.clientName, document: validated.value, createdAt: timestamp, updatedAt: timestamp } }, 201);
}

async function updateRoadmap(request, db, id) {
  const body = await readBody(request);
  if (body.error) return apiError(body.status ?? 400, body.error);
  const validated = validateRoadmapDocumentForStorage(body.value);
  if (validated.error) return apiError(400, validated.error);

  const timestamp = new Date().toISOString();
  const result = await db.prepare(`UPDATE roadmaps
    SET client_name = ?, document_json = ?, updated_at = ? WHERE id = ?`)
    .bind(validated.value.clientName, JSON.stringify(validated.value), timestamp, id)
    .run();
  if (!result.meta?.changes) return apiError(404, "저장된 로드맵을 찾을 수 없습니다.");
  return json({ item: { id, clientName: validated.value.clientName, document: validated.value, updatedAt: timestamp } });
}

async function deleteRoadmap(db, id) {
  const result = await db.prepare("DELETE FROM roadmaps WHERE id = ?").bind(id).run();
  if (!result.meta?.changes) return apiError(404, "저장된 로드맵을 찾을 수 없습니다.");
  return json({ deleted: true, id });
}

async function handleApi(request, env, pathname) {
  if (!pathname.startsWith("/api/")) return null;
  const isCatalog = pathname === CATALOG_PATH || pathname.startsWith(`${CATALOG_PATH}/`);
  const isRoadmap = pathname === ROADMAP_PATH || pathname.startsWith(`${ROADMAP_PATH}/`);
  if (!isCatalog && !isRoadmap) {
    return apiError(404, "API 경로를 찾을 수 없습니다.");
  }
  if (!env.DB) return apiError(503, "공유 저장소를 사용할 수 없습니다.");

  if (["POST", "PUT"].includes(request.method)
    && !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return apiError(415, "JSON 형식으로 요청해 주세요.");
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
