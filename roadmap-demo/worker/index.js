import { INDUSTRY_OPTIONS, REGION_OPTIONS } from "../catalog-options.js";

const CATALOG_PATH = "/api/catalog-programs";
const CATEGORIES = new Set(["consulting", "business", "voucher", "ip", "certification"]);
const FIELDS = new Set(["category", "title", "link", "amountKrw", "startMonth", "endMonth", "target", "details", "industries", "regions"]);
const INDUSTRIES = new Set(INDUSTRY_OPTIONS);
const REGIONS = new Set(REGION_OPTIONS);

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers });
}

function apiError(status, error, fields) {
  return json({ error, ...(fields ? { fields } : {}) }, status);
}

function catalogId(pathname) {
  const match = pathname.match(/^\/api\/catalog-programs\/([^/]+)$/);
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
    return { value: await request.json() };
  } catch {
    return { error: "올바른 JSON 요청이 아닙니다." };
  }
}

async function createCatalog(request, db) {
  const body = await readBody(request);
  if (body.error) return apiError(400, body.error);
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
  if (body.error) return apiError(400, body.error);
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

async function handleApi(request, env, pathname) {
  if (!pathname.startsWith("/api/")) return null;
  if (pathname !== CATALOG_PATH && !pathname.startsWith(`${CATALOG_PATH}/`)) {
    return apiError(404, "API 경로를 찾을 수 없습니다.");
  }
  if (!env.DB) return apiError(503, "사업 카탈로그 저장소를 사용할 수 없습니다.");

  if (["POST", "PUT"].includes(request.method)
    && !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return apiError(415, "JSON 형식으로 요청해 주세요.");
  }

  const id = pathname === CATALOG_PATH ? null : catalogId(pathname);
  if (id === "" || (pathname !== CATALOG_PATH && id === null)) return apiError(404, "등록된 사업을 찾을 수 없습니다.");

  try {
    if (pathname === CATALOG_PATH && request.method === "GET") return listCatalog(request, env.DB);
    if (pathname === CATALOG_PATH && request.method === "POST") return createCatalog(request, env.DB);
    if (id && request.method === "PUT") return updateCatalog(request, env.DB, id);
    if (id && request.method === "DELETE") return deleteCatalog(env.DB, id);
    return apiError(405, "지원하지 않는 요청 방식입니다.");
  } catch (error) {
    console.error("catalog api error", error);
    return apiError(500, "사업 카탈로그 요청을 처리하지 못했습니다.");
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
