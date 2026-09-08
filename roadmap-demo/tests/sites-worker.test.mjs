import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { BUSINESS_SUBCATEGORY_OPTIONS, INDUSTRY_OPTIONS, REGION_OPTIONS, inferBusinessSubcategories } from "../catalog-options.js";
import worker, { validateCatalogProgram } from "../worker/index.js";

const { extractBizinfoCatalogDraft, fetchBizinfoHtml, validateBizinfoDetailUrl } = worker;

const bizinfoUrl = "https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=PBLN_000000000117819";

const bizinfoHtmlFixture = `
<html><head><title>2026년 초기창업패키지 모집 공고</title></head><body>
<ul class="view_cont">
  <li><span class="s_title">신청기간</span><div class="txt">2026.01.23 ~ 2026.02.13</div></li>
  <li><span class="s_title">사업개요</span><div class="txt">
    <p>초기창업기업의 사업 안정화와 성장을 지원합니다.</p>
    <p>☞ 창업 후 3년 이내 초기창업기업</p>
    <p>☞ 사업화 자금(최대 1억원, 평균 0.5억원) 지원</p>
  </div></li>
</ul></body></html>`;

test("extracts confident Bizinfo fields without mapping application dates to roadmap months", () => {
  const result = extractBizinfoCatalogDraft(bizinfoHtmlFixture, bizinfoUrl);
  assert.equal(result.sourceUrl, bizinfoUrl);
  assert.equal(result.draft.title, "2026년 초기창업패키지 모집 공고");
  assert.equal(result.draft.category, "business");
  assert.equal(result.draft.link, bizinfoUrl);
  assert.equal(result.draft.amountKrw, 100_000_000);
  assert.equal(result.draft.startMonth, "");
  assert.equal(result.draft.endMonth, "");
  assert.equal(result.draft.target, "창업 후 3년 이내 초기창업기업");
  assert.match(result.draft.details, /사업 안정화/);
  assert.equal(result.references.applicationPeriod, "2026.01.23 ~ 2026.02.13");
  assert.deepEqual(result.draft.industries, []);
});

test("rejects a Bizinfo page whose expected structure is missing", () => {
  assert.throws(
    () => extractBizinfoCatalogDraft("<html><head></head><body></body></html>", bizinfoUrl),
    (error) => error.code === "BIZINFO_HTML_STRUCTURE_CHANGED",
  );
});

test("classifies explicit voucher benefits and falls back to business", () => {
  const voucher = extractBizinfoCatalogDraft(bizinfoHtmlFixture.replace("사업화 자금", "바우처 포인트"), bizinfoUrl);
  assert.equal(voucher.draft.category, "voucher");
});

test("validates and safely fetches one Bizinfo detail HTML page", async () => {
  const validated = validateBizinfoDetailUrl(bizinfoUrl);
  assert.equal(validated.error, undefined);
  assert.equal(validated.value.toString(), bizinfoUrl);

  let requestOptions;
  const result = await fetchBizinfoHtml(bizinfoUrl, {
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      return new Response("<html><title>지원사업</title></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });
  assert.equal(result.url, bizinfoUrl);
  assert.match(result.html, /지원사업/);
  assert.equal(requestOptions.redirect, "manual");
  assert.ok(requestOptions.signal instanceof AbortSignal);
});

test("rejects unsupported Bizinfo URLs and unsafe responses", async () => {
  for (const value of [
    "http://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=PBLN_1",
    "https://evil.example/sii/siia/selectSIIA200Detail.do?pblancId=PBLN_1",
    "https://www.bizinfo.go.kr/other?pblancId=PBLN_1",
    "https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do",
    `${bizinfoUrl}&other=value`,
  ]) {
    assert.equal(validateBizinfoDetailUrl(value).error.code, "BIZINFO_URL_NOT_ALLOWED");
  }

  await assert.rejects(
    fetchBizinfoHtml(bizinfoUrl, {
      fetchImpl: async () => new Response("redirect", { status: 302, headers: { location: "https://evil.example/" } }),
    }),
    (error) => error.code === "BIZINFO_REDIRECT_NOT_ALLOWED",
  );
  await assert.rejects(
    fetchBizinfoHtml(bizinfoUrl, {
      fetchImpl: async () => new Response("{}", { headers: { "content-type": "application/json" } }),
    }),
    (error) => error.code === "BIZINFO_CONTENT_TYPE_INVALID",
  );
  await assert.rejects(
    fetchBizinfoHtml(bizinfoUrl, {
      maxBytes: 4,
      fetchImpl: async () => new Response("12345", { headers: { "content-type": "text/html" } }),
    }),
    (error) => error.code === "BIZINFO_RESPONSE_TOO_LARGE",
  );
});

test("times out a stalled Bizinfo fetch", async () => {
  await assert.rejects(
    fetchBizinfoHtml(bizinfoUrl, { timeoutMs: 5, fetchImpl: async () => new Promise(() => {}) }),
    (error) => error.code === "BIZINFO_FETCH_TIMEOUT",
  );
});

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/assets/app.js"]);
});

test("falls back to index.html for an unknown app route", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/flow/step-two?source=share", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/index.html" ? "app" : "missing", {
            status: url.pathname === "/index.html" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/flow/step-two?source=share", "/index.html"]);
});

test("does not turn missing API or write requests into the app shell", async () => {
  let calls = 0;
  const env = {
    ASSETS: {
      fetch: async () => {
        calls += 1;
        return new Response("missing", { status: 404 });
      },
    },
  };

  const apiResponse = await worker.fetch(
    new Request("https://example.test/api/missing", { headers: { accept: "application/json" } }),
    env,
  );
  assert.equal(apiResponse.status, 404);
  assert.equal(calls, 0);

  const writeResponse = await worker.fetch(
    new Request("https://example.test/flow", { method: "POST", headers: { accept: "text/html" } }),
    env,
  );
  assert.equal(writeResponse.status, 404);
  assert.equal(calls, 1);
});

function createDatabase() {
  const rows = [];
  const options = [];
  const bindingCounts = [];
  const statementByteLengths = [];
  const filterRows = (statement, params) => {
    let index = 0;
    const hasSearch = statement.includes("title LIKE ?");
    const query = hasSearch ? String(params[index++]).slice(1, -1).toLowerCase() : "";
    const hasCategory = statement.includes("category = ?");
    const category = hasCategory ? params[index++] : "";
    const hasMonthRange = statement.includes("start_month <= ? AND end_month >= ?");
    const endMonth = hasMonthRange ? params[index++] : null;
    const startMonth = hasMonthRange ? params[index++] : null;
    const hasIndustries = statement.includes("json_each(industries_json)");
    const industryCount = hasIndustries ? (statement.match(/json_each\(industries_json\)[^)]+\)/)?.[0].match(/\?/g) ?? []).length : 0;
    const industries = params.slice(index, index + industryCount);
    index += industryCount;
    const hasRegions = statement.includes("json_each(regions_json)");
    const regionCount = hasRegions ? (statement.match(/json_each\(regions_json\)[^)]+\)/)?.[0].match(/\?/g) ?? []).length : 0;
    const regions = params.slice(index, index + regionCount);
    const businessSubcategories = BUSINESS_SUBCATEGORY_OPTIONS.filter((tag) => statement.includes(`business-subcategory:${tag}`));

    return rows
      .filter((row) => !query || row.title.toLowerCase().includes(query))
      .filter((row) => !category || row.category === category)
      .filter((row) => !hasMonthRange || (row.startMonth <= endMonth && row.endMonth >= startMonth))
      .filter((row) => !industries.length || JSON.parse(row.industriesJson).some((value) => industries.includes(value)))
      .filter((row) => !regions.length || JSON.parse(row.regionsJson).some((value) => regions.includes(value)))
      .filter((row) => !businessSubcategories.length || inferBusinessSubcategories({ ...row, mainPackage: row.mainPackage === 1 })
        .some((tag) => businessSubcategories.includes(tag)));
  };
  return {
    rows,
    options,
    bindingCounts,
    statementByteLengths,
    prepare(sql) {
      statementByteLengths.push(new TextEncoder().encode(sql).length);
      const statement = sql.replace(/\s+/g, " ").trim();
      return {
        bind(...params) {
          bindingCounts.push(params.length);
          return {
            async all() {
              if (statement.startsWith("SELECT kind, value FROM catalog_options")) {
                return { results: options.toSorted((left, right) => left.kind.localeCompare(right.kind) || left.value.localeCompare(right.value)) };
              }
              const pageParams = params.slice(params.length - 2);
              const [limit, offset] = pageParams;
              const rankStart = statement.includes("CASE WHEN start_month = ?") ? params[params.length - 10] : null;
              const rankEnd = statement.includes("CASE WHEN start_month = ?") ? params[params.length - 9] : null;
              const items = filterRows(statement, params)
                .sort((left, right) => {
                  if (rankStart !== null) {
                    const rank = (row) => row.startMonth === rankStart && row.endMonth === rankEnd ? 0
                      : row.startMonth <= rankStart && row.endMonth >= rankEnd ? 1 : 2;
                    const distance = (row) => rank(row) === 1 ? (rankStart - row.startMonth) + (row.endMonth - rankEnd) : 999;
                    if (rank(left) !== rank(right)) return rank(left) - rank(right);
                    if (distance(left) !== distance(right)) return distance(left) - distance(right);
                  }
                  return right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id);
                })
                .slice(offset, offset + limit);
              return { results: items };
            },
            async first() {
              if (statement.startsWith("SELECT id, title FROM catalog_programs WHERE link = ?")) {
                const row = rows.find((item) => item.link === params[0]);
                return row ? { id: row.id, title: row.title } : null;
              }
              return {
                total: filterRows(statement, params).length,
              };
            },
            async run() {
              if (statement.startsWith("INSERT OR IGNORE INTO catalog_options")) {
                const [kind, value, createdAt] = params;
                if (options.some((item) => item.kind === kind && item.value === value)) return { meta: { changes: 0 } };
                options.push({ kind, value, createdAt });
                return { meta: { changes: 1 } };
              }
              if (statement.startsWith("INSERT")) {
                const [id, category, title, link, amountKrw, startMonth, endMonth, target, details, industriesJson, regionsJson, mainPackage, createdAt, updatedAt, duplicateLink] = params;
                if (duplicateLink && rows.some((item) => item.link === duplicateLink)) return { meta: { changes: 0 } };
                rows.push({ id, category, title, link, amountKrw, startMonth, endMonth, target, details, industriesJson, regionsJson, mainPackage, createdAt, updatedAt });
                return { meta: { changes: 1 } };
              }
              if (statement.startsWith("UPDATE catalog_programs SET verified_year")) {
                const [verifiedYear, id] = params;
                const row = rows.find((item) => item.id === id);
                if (!row) return { meta: { changes: 0 } };
                row.verifiedYear = verifiedYear;
                return { meta: { changes: 1 } };
              }
              if (statement.startsWith("UPDATE")) {
                const [category, title, link, amountKrw, startMonth, endMonth, target, details, industriesJson, regionsJson, mainPackage, updatedAt, id, duplicateLink, duplicateId] = params;
                const row = rows.find((item) => item.id === id);
                if (!row) return { meta: { changes: 0 } };
                if (duplicateLink && rows.some((item) => item.id !== duplicateId && item.link === duplicateLink)) return { meta: { changes: 0 } };
                Object.assign(row, { category, title, link, amountKrw, startMonth, endMonth, target, details, industriesJson, regionsJson, mainPackage, updatedAt });
                return { meta: { changes: 1 } };
              }
              if (statement.startsWith("DELETE")) {
                const index = rows.findIndex((item) => item.id === params[0]);
                if (index === -1) return { meta: { changes: 0 } };
                rows.splice(index, 1);
                return { meta: { changes: 1 } };
              }
              throw new Error(`Unsupported statement: ${statement}`);
            },
          };
        },
      };
    },
  };
}

function createRoadmapDatabase() {
  const rows = [];
  const options = [];
  return {
    rows,
    options,
    prepare(sql) {
      const statement = sql.replace(/\s+/g, " ").trim();
      return {
        bind(...params) {
          return {
            async all() {
              if (statement.startsWith("SELECT kind, value FROM catalog_options")) {
                return { results: options.toSorted((left, right) => left.kind.localeCompare(right.kind) || left.value.localeCompare(right.value)) };
              }
              const [limit, offset] = params;
              return {
                results: rows
                  .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))
                  .slice(offset, offset + limit)
                  .map(({ id, tier, clientName, createdAt, updatedAt }) => ({ id, tier, clientName, createdAt, updatedAt })),
              };
            },
            async first() {
              if (statement.startsWith("SELECT COUNT")) return { total: rows.length };
              if (statement.startsWith("SELECT tier FROM roadmaps")) {
                const row = rows.find((item) => item.id === params[0]);
                return row ? { tier: row.tier } : null;
              }
              return rows.find((item) => item.id === params[0]) ?? null;
            },
            async run() {
              if (statement.startsWith("INSERT")) {
                const [id, tier, clientName, documentJson, createdAt, updatedAt] = params;
                rows.push({ id, tier, clientName, documentJson, createdAt, updatedAt });
                return { meta: { changes: 1 } };
              }
              if (statement.startsWith("UPDATE")) {
                const [clientName, documentJson, updatedAt, id] = params;
                const row = rows.find((item) => item.id === id);
                if (!row) return { meta: { changes: 0 } };
                Object.assign(row, { clientName, documentJson, updatedAt });
                return { meta: { changes: 1 } };
              }
              if (statement.startsWith("DELETE")) {
                const index = rows.findIndex((item) => item.id === params[0]);
                if (index === -1) return { meta: { changes: 0 } };
                rows.splice(index, 1);
                return { meta: { changes: 1 } };
              }
              throw new Error(`Unsupported statement: ${statement}`);
            },
          };
        },
      };
    },
  };
}

const catalogInput = {
  category: "business",
  title: "2026년 해양수산 오픈이노베이션 사업",
  link: "https://scceioi.kr/2026/kimst/index.php#mEnter",
  amountKrw: 30_000_000,
  startMonth: 6,
  endMonth: 7,
  target: "해양 분야 스타트업",
  details: "테스트 베드와 후속 투자 검토",
  industries: ["농림·수산·해양"],
  regions: ["서울", "부산"],
  mainPackage: false,
};

test("rejects excluded funding terms in program names and support details", () => {
  assert.equal(
    validateCatalogProgram({ ...catalogInput, title: "중소기업 운전 자금 지원" }).fields.title,
    "육성자금·운전자금 사업은 등록할 수 없습니다.",
  );
  assert.equal(
    validateCatalogProgram({ ...catalogInput, details: "지역기업 육성\n자금 지원" }).fields.details,
    "육성자금·운전자금 사업은 등록할 수 없습니다.",
  );
});

test("validates and persists catalog CRUD through D1", async () => {
  const DB = createDatabase();
  const env = { DB };
  const request = (path, options) => worker.fetch(new Request(`https://example.test${path}`, options), env);

  const invalid = await request("/api/catalog-programs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...catalogInput, link: "javascript:alert(1)" }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(DB.rows.length, 0);

  const consulting = await request("/api/catalog-programs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...catalogInput, category: "consulting" }),
  });
  assert.equal(consulting.status, 400);
  assert.equal(DB.rows.length, 0);

  const consultingList = await request("/api/catalog-programs?category=consulting&limit=50&offset=0");
  assert.equal(consultingList.status, 400);

  const wrongMediaType = await request("/api/catalog-programs", {
    method: "POST",
    body: JSON.stringify(catalogInput),
  });
  assert.equal(wrongMediaType.status, 415);
  assert.equal(DB.rows.length, 0);

  const createdResponse = await request("/api/catalog-programs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(catalogInput),
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 201);
  assert.equal(created.item.title, catalogInput.title);
  assert.deepEqual(created.item.industries, catalogInput.industries);
  assert.deepEqual(created.item.regions, catalogInput.regions);
  assert.deepEqual(created.item.businessSubcategories, []);
  assert.equal(DB.rows.length, 1);

  const duplicate = await request("/api/catalog-programs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(catalogInput),
  });
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), {
    error: "CATALOG_LINK_DUPLICATE",
    message: `This source link is already registered as ${catalogInput.title}.`,
    existing: { id: created.item.id, title: catalogInput.title },
  });
  assert.equal(DB.rows.length, 1);

  const multipleIndustries = await request("/api/catalog-programs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...catalogInput, industries: [INDUSTRY_OPTIONS[0], INDUSTRY_OPTIONS[1]] }),
  });
  assert.equal(multipleIndustries.status, 400);
  assert.equal(DB.rows.length, 1);

  const unknownTag = await request("/api/catalog-programs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...catalogInput, industries: ["목록에 없음"] }),
  });
  assert.equal(unknownTag.status, 400);
  assert.equal(DB.rows.length, 1);

  const listResponse = await request("/api/catalog-programs?q=해양&limit=50&offset=0");
  const list = await listResponse.json();
  assert.equal(list.total, 1);
  assert.equal(list.items[0].id, created.item.id);

  const categoryResponse = await request("/api/catalog-programs?category=business&limit=50&offset=0");
  const categoryList = await categoryResponse.json();
  assert.equal(categoryList.total, 1);
  assert.equal(categoryList.items[0].id, created.item.id);

  const updatedResponse = await request(`/api/catalog-programs/${created.item.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...catalogInput, title: "수정된 사업", amountKrw: 300_000 }),
  });
  assert.equal(updatedResponse.status, 200);
  assert.equal(DB.rows[0].title, "수정된 사업");
  assert.equal(DB.rows[0].amountKrw, 300_000);

  const deletedResponse = await request(`/api/catalog-programs/${created.item.id}`, { method: "DELETE" });
  assert.equal(deletedResponse.status, 200);
  assert.equal(DB.rows.length, 0);
});

test("normalizes catalog support text before Worker validation and persistence", async () => {
  const DB = createDatabase();
  const request = (path, options) => worker.fetch(new Request(`https://example.test${path}`, options), { DB });
  const response = await request("/api/catalog-programs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...catalogInput, target: "• business\n• youth business", details: "• diagnosis\n• consulting" }),
  });
  const created = await response.json();
  assert.equal(response.status, 201);
  assert.equal(created.item.target, "- business\n- youth business");
  assert.equal(created.item.details, "- diagnosis\n- consulting");
  assert.equal(DB.rows[0].target, created.item.target);
  assert.equal(DB.rows[0].details, created.item.details);
});

test("recomputes automatic business tags while preserving manual main package", async () => {
  const DB = createDatabase();
  const request = (path, options) => worker.fetch(new Request(`https://example.test${path}`, options), { DB });
  const createdResponse = await request("/api/catalog-programs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...catalogInput,
      title: "일본 데모데이 마케팅 사업",
      target: "여성기업 대상",
      details: "수출 컨설팅 지원",
      mainPackage: true,
    }),
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 201);
  assert.deepEqual(created.item.businessSubcategories, BUSINESS_SUBCATEGORY_OPTIONS);
  assert.equal(DB.rows[0].mainPackage, 1);

  const updatedResponse = await request(`/api/catalog-programs/${created.item.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...catalogInput, title: "일반 사업화", details: "시제품 제작 지원", mainPackage: true }),
  });
  const updated = await updatedResponse.json();
  assert.equal(updatedResponse.status, 200);
  assert.deepEqual(updated.item.businessSubcategories, ["메인패키지"]);

  const invalidMain = await request(`/api/catalog-programs/${created.item.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...catalogInput, category: "voucher", mainPackage: true }),
  });
  assert.equal(invalidMain.status, 400);
  assert.equal(DB.rows[0].mainPackage, 1);
});

test("keeps upper-industry choices fixed while allowing shared region choices", async () => {
  const DB = createDatabase();
  const env = { DB };
  const request = (path, options) => worker.fetch(new Request(`https://example.test${path}`, options), env);

  const industryResponse = await request("/api/catalog-options", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "industry", value: "  Space Tech  " }),
  });
  assert.equal(industryResponse.status, 400);

  const invalidRegionResponse = await request("/api/catalog-options", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "region", value: "광주 동" }),
  });
  assert.equal(invalidRegionResponse.status, 400);
  DB.options.push({ kind: "region", value: "광주 동", createdAt: new Date().toISOString() });

  const regionResponse = await request("/api/catalog-options", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "region", value: "Mars Base" }),
  });
  assert.equal(regionResponse.status, 201);

  const invalidResponse = await request("/api/catalog-options", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "industry", value: " " }),
  });
  assert.equal(invalidResponse.status, 400);
  assert.equal(DB.options.length, 2);

  const unknownFieldResponse = await request("/api/catalog-options", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "industry", value: "Valid", extra: true }),
  });
  assert.equal(unknownFieldResponse.status, 400);
  assert.equal(DB.options.length, 2);

  const optionsResponse = await request("/api/catalog-options");
  const options = await optionsResponse.json();
  assert.equal(options.industries.includes(INDUSTRY_OPTIONS[0]), true);
  assert.equal(options.regions.includes(REGION_OPTIONS[0]), true);
  assert.equal(options.industries.length, INDUSTRY_OPTIONS.length);
  assert.equal(options.regions.includes("Mars Base"), true);
  assert.equal(options.regions.includes("광주 동"), false);

  const failedCatalog = await request("/api/catalog-programs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...catalogInput, link: "ftp://example.test", regions: ["Mars Base"] }),
  });
  assert.equal(failedCatalog.status, 400);
  assert.equal(DB.options.length, 2);
  assert.equal(DB.rows.length, 0);

  const createdCatalog = await request("/api/catalog-programs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...catalogInput, regions: ["Mars Base"] }),
  });
  assert.equal(createdCatalog.status, 201);
  assert.equal(DB.rows.length, 1);
});

test("filters catalog tags with OR within dimensions and AND before pagination", async () => {
  const DB = createDatabase();
  const row = (id, category, title, industries, regions, updatedAt) => ({
    id,
    category,
    title,
    link: "https://example.test",
    amountKrw: 1_000_000,
    startMonth: 1,
    endMonth: 2,
    target: `${title} target`,
    details: `${title} details`,
    industriesJson: JSON.stringify(industries),
    regionsJson: JSON.stringify(regions),
    createdAt: updatedAt,
    updatedAt,
  });
  DB.rows.push(
    row("skip-latest", "business", "Newest", ["Food"], ["Seoul"], "2026-01-03T00:00:00.000Z"),
    row("ai-busan", "business", "AI Busan", ["AI"], ["Busan"], "2026-01-02T00:00:00.000Z"),
    row("robot-seoul", "business", "Robot Seoul", ["Robotics"], ["Seoul"], "2026-01-01T00:00:00.000Z"),
  );
  const env = { DB };
  const request = (path) => worker.fetch(new Request(`https://example.test${path}`), env);

  const industryOnly = await (await request("/api/catalog-programs?category=business&industry=AI&industry=Robotics&limit=1&offset=0")).json();
  assert.equal(industryOnly.total, 2);
  assert.deepEqual(industryOnly.items.map((item) => item.id), ["ai-busan"]);

  const industryAndRegion = await (await request("/api/catalog-programs?category=business&industry=AI&industry=Robotics&region=Seoul&limit=50&offset=0")).json();
  assert.equal(industryAndRegion.total, 1);
  assert.deepEqual(industryAndRegion.items.map((item) => item.id), ["robot-seoul"]);

  const tooManyFilters = await request(`/api/catalog-programs?${Array.from({ length: 21 }, (_, index) => `industry=i${index}`).join("&")}`);
  assert.equal(tooManyFilters.status, 400);
});

test("matches nationwide and selected regions as a catalog union", async () => {
  const DB = createDatabase();
  const row = (id, regions, updatedAt) => ({
    id,
    category: "business",
    title: id,
    link: "https://example.test",
    amountKrw: 1_000_000,
    startMonth: 1,
    endMonth: 2,
    target: id,
    details: id,
    industriesJson: "[]",
    regionsJson: JSON.stringify(regions),
    createdAt: updatedAt,
    updatedAt,
  });
  DB.rows.push(
    row("nationwide", ["전국"], "2026-01-03T00:00:00.000Z"),
    row("seoul", ["서울"], "2026-01-02T00:00:00.000Z"),
    row("busan", ["부산"], "2026-01-01T00:00:00.000Z"),
  );
  const response = await worker.fetch(new Request("https://example.test/api/catalog-programs?category=business&region=전국&region=서울&limit=50&offset=0"), { DB });
  const result = await response.json();

  assert.equal(result.total, 2);
  assert.deepEqual(result.items.map((item) => item.id), ["nationwide", "seoul"]);
});

test("searches catalog program titles only", async () => {
  const DB = createDatabase();
  const row = (id, title, target, details) => ({
    id,
    category: "business",
    title,
    link: "https://example.test",
    amountKrw: 1_000_000,
    startMonth: 1,
    endMonth: 12,
    target,
    details,
    industriesJson: "[]",
    regionsJson: "[]",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  DB.rows.push(
    row("title-match", "AI 사업화", "중소기업", "제품 개발"),
    row("target-only", "성장 지원", "AI 기업", "판로 지원"),
    row("details-only", "수출 지원", "중소기업", "AI 솔루션 고도화"),
  );

  const response = await worker.fetch(new Request("https://example.test/api/catalog-programs?q=AI&limit=50&offset=0"), { DB });
  const result = await response.json();

  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map((item) => item.id), ["title-match"]);
});

test("filters catalog by overlapping months before pagination", async () => {
  const DB = createDatabase();
  const row = (id, startMonth, endMonth, updatedAt) => ({
    id, category: "business", title: id, link: "https://example.test", amountKrw: 1_000_000,
    startMonth, endMonth, target: id, details: id, industriesJson: "[]", regionsJson: "[]",
    createdAt: updatedAt, updatedAt,
  });
  DB.rows.push(
    row("latest", 11, 12, "2026-12-01T00:00:00.000Z"),
    row("recent", 11, 12, "2026-11-01T00:00:00.000Z"),
    row("closest-cover", 10, 12, "2026-01-01T00:00:00.000Z"),
    row("wide-cover", 9, 12, "2026-10-01T00:00:00.000Z"),
  );
  const request = (path) => worker.fetch(new Request(`https://example.test${path}`), { DB });

  const allPrograms = await (await request("/api/catalog-programs?category=business&limit=50&offset=0")).json();
  assert.deepEqual(allPrograms.items.map((item) => item.id), ["latest", "recent", "wide-cover", "closest-cover"]);

  const novemberToDecember = await (await request("/api/catalog-programs?category=business&startMonth=11&endMonth=12&limit=50&offset=0")).json();
  assert.equal(novemberToDecember.total, 4);
  assert.deepEqual(novemberToDecember.items.map((item) => item.id), ["latest", "recent", "closest-cover", "wide-cover"]);

  assert.equal((await request("/api/catalog-programs?category=business&startMonth=7&endMonth=6")).status, 400);
});

test("manually verifies catalog programs for the current Korea year", async () => {
  const DB = createDatabase();
  const updatedAt = "2026-01-01T00:00:00.000Z";
  DB.rows.push({
    id: "verify-me", category: "business", title: "Verify me", link: "https://example.test",
    amountKrw: 1_000_000, startMonth: 1, endMonth: 12, target: "target", details: "details",
    industriesJson: "[]", regionsJson: "[]", mainPackage: 0, verifiedYear: null,
    createdAt: updatedAt, updatedAt,
  });
  const request = (options = {}) => worker.fetch(new Request("https://example.test/api/catalog-programs/verify-me", options), { DB });

  assert.equal((await request({ method: "PATCH", body: JSON.stringify({ verified: true }) })).status, 415);
  assert.equal((await request({
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ verifiedYear: 2099 }),
  })).status, 400);

  const verifiedResponse = await request({
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ verified: true }),
  });
  const verified = await verifiedResponse.json();
  const koreaYear = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date()));
  assert.equal(verifiedResponse.status, 200);
  assert.equal(verified.currentYear, koreaYear);
  assert.equal(verified.item.verifiedYear, koreaYear);
  assert.equal(DB.rows[0].verifiedYear, koreaYear);
  assert.equal(DB.rows[0].updatedAt, updatedAt);

  const list = await (await worker.fetch(new Request("https://example.test/api/catalog-programs"), { DB })).json();
  assert.equal(list.currentYear, koreaYear);
  assert.equal(list.items[0].verifiedYear, koreaYear);

  const clearedResponse = await request({
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ verified: false }),
  });
  assert.equal(clearedResponse.status, 200);
  assert.equal((await clearedResponse.json()).item.verifiedYear, null);
  assert.equal(DB.rows[0].verifiedYear, null);

  const missingResponse = await worker.fetch(new Request("https://example.test/api/catalog-programs/missing", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ verified: true }),
  }), { DB });
  assert.equal(missingResponse.status, 404);
});

test("derives and filters multiple business subcategories before pagination", async () => {
  const DB = createDatabase();
  const row = (id, title, details, regions, mainPackage, updatedAt) => ({
    id,
    category: "business",
    title,
    link: "https://example.test",
    amountKrw: 1_000_000,
    startMonth: 1,
    endMonth: 2,
    target: `${title} 대상`,
    details,
    industriesJson: "[]",
    regionsJson: JSON.stringify(regions),
    mainPackage: mainPackage ? 1 : 0,
    createdAt: updatedAt,
    updatedAt,
  });
  DB.rows.push(
    row("domestic", "대한민국 창업 지원", "국내 판로 지원", ["서울"], false, "2026-01-03T00:00:00.000Z"),
    row("export", "일본 데모데이", "마케팅 및 컨설팅 지원", ["부산"], false, "2026-01-02T00:00:00.000Z"),
    row("main", "일반 사업화", "시제품 지원", ["서울"], true, "2026-01-01T00:00:00.000Z"),
    row("women", "여성기업 지원", "일반 지원", ["서울"], false, "2025-12-31T00:00:00.000Z"),
  );
  const request = (path) => worker.fetch(new Request(`https://example.test${path}`), { DB });

  const tags = await (await request("/api/catalog-programs?category=business&businessSubcategory=메인패키지&businessSubcategory=수출&limit=1&offset=0")).json();
  assert.equal(tags.total, 2);
  assert.deepEqual(tags.items.map((item) => item.id), ["export"]);
  assert.deepEqual(tags.items[0].businessSubcategories, ["경진대회", "수출", "마케팅", "컨설팅"]);
  assert.ok(Math.max(...DB.bindingCounts) <= 100);
  assert.ok(Math.max(...DB.statementByteLengths) <= 100_000);

  const tagAndRegion = await (await request("/api/catalog-programs?category=business&businessSubcategory=수출&region=서울&limit=50&offset=0")).json();
  assert.equal(tagAndRegion.total, 0);

  assert.equal((await request("/api/catalog-programs?category=voucher&businessSubcategory=수출")).status, 400);
  assert.equal((await request("/api/catalog-programs?category=business&businessSubcategory=기타")).status, 400);

  const women = await (await request("/api/catalog-programs?category=business&businessSubcategory=여성기업&limit=50&offset=0")).json();
  assert.equal(women.total, 1);
  assert.deepEqual(women.items.map((item) => item.id), ["women"]);
  assert.deepEqual(women.items[0].businessSubcategories, ["여성기업"]);
});

test("persists public roadmap drafts without applying PDF validity rules", async () => {
  const DB = createRoadmapDatabase();
  const env = { DB };
  const request = (path, options) => worker.fetch(new Request(`https://example.test${path}`, options), env);
  const draft = {
    tier: "standard",
    clientName: "",
    programs: [{
      id: "draft-1",
      category: "business",
      displayCategory: "marketing",
      title: "",
      link: "",
      amountKrw: null,
      startMonth: 12,
      endMonth: 1,
      target: "",
      details: "",
      sequence: 0,
      laneIndex: 3,
    }],
  };

  const invalidShape = await request("/api/roadmaps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...draft, unsupported: true }),
  });
  assert.equal(invalidShape.status, 400);

  const invalidAmount = await request("/api/roadmaps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...draft, programs: [{ ...draft.programs[0], amountKrw: "" }] }),
  });
  assert.equal(invalidAmount.status, 400);

  const unsafeLink = await request("/api/roadmaps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...draft, programs: [{ ...draft.programs[0], link: "javascript:alert(1)" }] }),
  });
  assert.equal(unsafeLink.status, 400);

  const missingTier = await request("/api/roadmaps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientName: "", programs: [] }),
  });
  assert.equal(missingTier.status, 400);
  assert.equal(DB.rows.length, 0);

  const standardCertification = await request("/api/roadmaps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...draft,
      programs: [{ ...draft.programs[0], id: "cert-1", category: "certification", displayCategory: undefined }],
    }),
  });
  assert.equal(standardCertification.status, 400);
  assert.equal(DB.rows.length, 0);

  const invalidMarketing = await request("/api/roadmaps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...draft,
      programs: [{ ...draft.programs[0], category: "voucher" }],
    }),
  });
  assert.equal(invalidMarketing.status, 400);
  assert.equal(DB.rows.length, 0);

  const premiumCertification = await request("/api/roadmaps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...draft,
      tier: "premium",
      programs: [{ ...draft.programs[0], id: "cert-1", category: "certification", displayCategory: undefined }],
    }),
  });
  assert.equal(premiumCertification.status, 201);
  assert.equal(DB.rows.length, 1);
  DB.rows.length = 0;

  const oversized = await request("/api/roadmaps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientName: "x".repeat(500_001), programs: [] }),
  });
  assert.equal(oversized.status, 413);

  const createdResponse = await request("/api/roadmaps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 201);
  assert.deepEqual(created.item.document, draft);
  assert.equal(created.item.tier, "standard");
  assert.equal(DB.rows.length, 1);
  assert.equal(DB.rows[0].tier, "standard");

  const listResponse = await request("/api/roadmaps?limit=50&offset=0");
  const list = await listResponse.json();
  assert.equal(list.total, 1);
  assert.equal(list.items[0].id, created.item.id);
  assert.equal(list.items[0].tier, "standard");
  assert.equal(Object.hasOwn(list.items[0], "document"), false);

  const openedResponse = await request(`/api/roadmaps/${created.item.id}`);
  const opened = await openedResponse.json();
  assert.deepEqual(opened.item.document, draft);
  assert.equal(opened.item.tier, "standard");

  const updatedDraft = { ...draft, clientName: "수정 중인 고객" };
  const updatedResponse = await request(`/api/roadmaps/${created.item.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(updatedDraft),
  });
  const updated = await updatedResponse.json();
  assert.equal(updatedResponse.status, 200);
  assert.deepEqual(updated.item.document, updatedDraft);
  assert.equal(DB.rows[0].tier, "standard");

  const tierChange = await request(`/api/roadmaps/${created.item.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...updatedDraft, tier: "premium" }),
  });
  assert.equal(tierChange.status, 409);
  assert.deepEqual(JSON.parse(DB.rows[0].documentJson), updatedDraft);

  const unsupportedMethod = await request(`/api/roadmaps/${created.item.id}`, { method: "PATCH" });
  assert.equal(unsupportedMethod.status, 405);

  DB.rows[0].documentJson = "{";
  const corruptResponse = await request(`/api/roadmaps/${created.item.id}`);
  assert.equal(corruptResponse.status, 500);
  DB.rows[0].documentJson = JSON.stringify(updatedDraft);

  const deletedResponse = await request(`/api/roadmaps/${created.item.id}`, { method: "DELETE" });
  assert.equal(deletedResponse.status, 200);
  assert.equal(DB.rows.length, 0);

  const missingResponse = await request(`/api/roadmaps/${created.item.id}`);
  assert.equal(missingResponse.status, 404);
});

test("persists optional roadmap client profiles through create, load, and update", async () => {
  const DB = createRoadmapDatabase();
  const env = { DB };
  const request = (path, options) => worker.fetch(new Request(`https://example.test${path}`, options), env);
  const draft = {
    tier: "premium",
    clientName: "Profiled client",
    clientProfile: {
      industries: [INDUSTRY_OPTIONS[0], INDUSTRY_OPTIONS[0]],
      regions: [REGION_OPTIONS[0]],
      isWomenOwned: true,
      tenure: 2.5,
    },
    programs: [{
      id: "profile-1",
      category: "business",
      title: "Profile program",
      link: "",
      amountKrw: null,
      startMonth: 1,
      endMonth: 2,
      target: "",
      details: "",
      sequence: 0,
      laneIndex: 2,
    }],
  };
  const normalizedProfile = { ...draft.clientProfile, industries: [INDUSTRY_OPTIONS[0]] };
  const normalizedDraft = { ...draft, clientProfile: normalizedProfile };

  const invalidProfile = await request("/api/roadmaps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...draft, clientProfile: { ...draft.clientProfile, regions: ["not a catalog region"] } }),
  });
  assert.equal(invalidProfile.status, 400);
  assert.equal(DB.rows.length, 0);

  const duplicateIds = await request("/api/roadmaps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...draft, programs: [draft.programs[0], { ...draft.programs[0], title: "Duplicate profile program" }] }),
  });
  assert.equal(duplicateIds.status, 400);
  assert.equal(DB.rows.length, 0);

  const createdResponse = await request("/api/roadmaps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 201);
  assert.deepEqual(created.item.document, normalizedDraft);
  assert.equal(created.item.document.programs[0].laneIndex, 2);
  assert.deepEqual(JSON.parse(DB.rows[0].documentJson), normalizedDraft);

  const opened = await (await request(`/api/roadmaps/${created.item.id}`)).json();
  assert.deepEqual(opened.item.document.clientProfile, normalizedProfile);
  assert.equal(opened.item.document.programs[0].laneIndex, 2);

  const updatedDraft = { ...normalizedDraft, clientProfile: { ...normalizedProfile, tenure: "prelaunch", isWomenOwned: false } };
  const updatedResponse = await request(`/api/roadmaps/${created.item.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(updatedDraft),
  });
  const updated = await updatedResponse.json();
  assert.equal(updatedResponse.status, 200);
  assert.deepEqual(updated.item.document, updatedDraft);
  assert.deepEqual(JSON.parse(DB.rows[0].documentJson), updatedDraft);
});

test("hydrates legacy roadmap JSON tier from the canonical row and rejects mismatches", async () => {
  const DB = createRoadmapDatabase();
  const env = { DB };
  const request = (path, options) => worker.fetch(new Request(`https://example.test${path}`, options), env);
  const timestamp = "2026-01-01T00:00:00.000Z";
  const legacyDocument = { clientName: "Legacy", programs: [] };
  DB.rows.push({
    id: "legacy-1",
    tier: "premium",
    clientName: "Legacy",
    documentJson: JSON.stringify(legacyDocument),
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const legacyResponse = await request("/api/roadmaps/legacy-1");
  const legacy = await legacyResponse.json();
  assert.equal(legacyResponse.status, 200);
  assert.deepEqual(legacy.item.document, { ...legacyDocument, tier: "premium" });
  assert.deepEqual(JSON.parse(DB.rows[0].documentJson), legacyDocument);

  const resaveResponse = await request("/api/roadmaps/legacy-1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(legacy.item.document),
  });
  assert.equal(resaveResponse.status, 200);
  assert.equal(DB.rows[0].tier, "premium");
  assert.deepEqual(JSON.parse(DB.rows[0].documentJson), { ...legacyDocument, tier: "premium" });

  DB.rows.push({
    id: "mismatch-1",
    tier: "standard",
    clientName: "Mismatch",
    documentJson: JSON.stringify({ tier: "premium", clientName: "Mismatch", programs: [] }),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const mismatchResponse = await request("/api/roadmaps/mismatch-1");
  assert.equal(mismatchResponse.status, 500);
  assert.equal((await mismatchResponse.json()).error, "ROADMAP_TIER_DATA_INTEGRITY");
  assert.equal(DB.rows[1].tier, "standard");
  assert.equal(JSON.parse(DB.rows[1].documentJson).tier, "premium");

  DB.rows.push({
    id: "invalid-row-tier",
    tier: "legacy-value",
    clientName: "Invalid row tier",
    documentJson: JSON.stringify({ tier: "premium", clientName: "Invalid row tier", programs: [] }),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const invalidRowTierResponse = await request("/api/roadmaps/invalid-row-tier");
  assert.equal(invalidRowTierResponse.status, 500);
  assert.equal((await invalidRowTierResponse.json()).error, "ROADMAP_TIER_DATA_INTEGRITY");
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
  await access(new URL("../dist/.openai/drizzle/0000_catalog_programs.sql", import.meta.url));
  await access(new URL("../dist/.openai/drizzle/0001_saved_roadmaps.sql", import.meta.url));
  await access(new URL("../dist/.openai/drizzle/0002_catalog_options.sql", import.meta.url));
  await access(new URL("../dist/.openai/drizzle/0006_catalog_business_subcategories.sql", import.meta.url));
  await access(new URL("../dist/.openai/drizzle/0008_catalog_funding_exclusions.sql", import.meta.url));
  await access(new URL("../dist/.openai/drizzle/0009_catalog_verified_year.sql", import.meta.url));
  await access(new URL("../dist/.openai/drizzle/0010_catalog_link_unique.sql", import.meta.url));
  await access(new URL("../dist/.openai/drizzle/meta/_journal.json", import.meta.url));
  const migration = await readFile(new URL("../drizzle/0003_saved_roadmaps_tier.sql", import.meta.url), "utf8");
  assert.match(migration, /ADD COLUMN tier TEXT NOT NULL DEFAULT 'premium'/);
  assert.match(migration, /CHECK \(tier IN \('premium', 'standard'\)\)/);
  const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  const linkMigration = await readFile(new URL("../drizzle/0010_catalog_link_unique.sql", import.meta.url), "utf8");
  assert.match(linkMigration, /CREATE INDEX IF NOT EXISTS idx_catalog_programs_link/);
  assert.equal(journal.entries.filter((entry) => entry.tag === "0003_saved_roadmaps_tier").length, 1);
  assert.equal(journal.entries.filter((entry) => entry.tag === "0006_catalog_business_subcategories").length, 1);
  assert.equal(journal.entries.filter((entry) => entry.tag === "0008_catalog_funding_exclusions").length, 1);
  assert.equal(journal.entries.filter((entry) => entry.tag === "0009_catalog_verified_year").length, 1);
  assert.equal(journal.entries.filter((entry) => entry.tag === "0010_catalog_link_unique").length, 1);
  const server = await readFile(new URL("../dist/server/index.js", import.meta.url), "utf8");
  assert.deepEqual(server.match(/^export /gm), ["export "]);
});
