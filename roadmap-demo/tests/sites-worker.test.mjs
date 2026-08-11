import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { BUSINESS_SUBCATEGORY_OPTIONS, INDUSTRY_OPTIONS, REGION_OPTIONS, inferBusinessSubcategories } from "../catalog-options.js";
import worker from "../worker/index.js";

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
    const hasSearch = statement.includes("(title LIKE ? OR target LIKE ? OR details LIKE ?)");
    const query = hasSearch ? String(params[index++]).slice(1, -1).toLowerCase() : "";
    if (hasSearch) index += 2;
    const hasCategory = statement.includes("category = ?");
    const category = hasCategory ? params[index++] : "";
    const hasSupportYear = statement.includes("support_year = ?");
    const supportYear = hasSupportYear ? params[index++] : null;
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
      .filter((row) => !query || [row.title, row.target, row.details]
        .some((value) => value.toLowerCase().includes(query)))
      .filter((row) => !category || row.category === category)
      .filter((row) => supportYear === null || row.supportYear === supportYear)
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
              const items = filterRows(statement, params)
                .sort((left, right) => (right.supportYear ?? -Infinity) - (left.supportYear ?? -Infinity)
                  || right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))
                .slice(offset, offset + limit);
              return { results: items };
            },
            async first() {
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
                const [id, category, title, link, amountKrw, startMonth, endMonth, target, details, industriesJson, regionsJson, mainPackage, supportYear, createdAt, updatedAt] = params;
                rows.push({ id, category, title, link, amountKrw, supportYear, startMonth, endMonth, target, details, industriesJson, regionsJson, mainPackage, createdAt, updatedAt });
                return { meta: { changes: 1 } };
              }
              if (statement.startsWith("UPDATE")) {
                const [category, title, link, amountKrw, startMonth, endMonth, target, details, industriesJson, regionsJson, mainPackage, supportYear, updatedAt, id] = params;
                const row = rows.find((item) => item.id === id);
                if (!row) return { meta: { changes: 0 } };
                Object.assign(row, { category, title, link, amountKrw, supportYear, startMonth, endMonth, target, details, industriesJson, regionsJson, mainPackage, updatedAt });
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
  return {
    rows,
    prepare(sql) {
      const statement = sql.replace(/\s+/g, " ").trim();
      return {
        bind(...params) {
          return {
            async all() {
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
  supportYear: 2026,
  startMonth: 6,
  endMonth: 7,
  target: "해양 분야 스타트업",
  details: "테스트 베드와 후속 투자 검토",
  industries: ["농림·수산·해양"],
  regions: ["서울", "부산"],
  mainPackage: false,
};

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

test("recomputes automatic business tags while preserving manual main package", async () => {
  const DB = createDatabase();
  const request = (path, options) => worker.fetch(new Request(`https://example.test${path}`, options), { DB });
  const createdResponse = await request("/api/catalog-programs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...catalogInput,
      title: "일본 데모데이 마케팅 사업",
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

test("filters catalog support years and overlapping months before pagination", async () => {
  const DB = createDatabase();
  const row = (id, supportYear, startMonth, endMonth, updatedAt) => ({
    id, category: "business", title: id, link: "https://example.test", amountKrw: 1_000_000,
    supportYear, startMonth, endMonth, target: id, details: id, industriesJson: "[]", regionsJson: "[]",
    createdAt: updatedAt, updatedAt,
  });
  DB.rows.push(
    row("legacy", null, 6, 7, "2026-12-01T00:00:00.000Z"),
    row("year-2025", 2025, 6, 7, "2026-11-01T00:00:00.000Z"),
    row("year-2026", 2026, 5, 6, "2026-01-01T00:00:00.000Z"),
    row("outside-month", 2026, 7, 8, "2026-10-01T00:00:00.000Z"),
  );
  const request = (path) => worker.fetch(new Request(`https://example.test${path}`), { DB });

  const allYears = await (await request("/api/catalog-programs?category=business&limit=50&offset=0")).json();
  assert.deepEqual(allYears.items.map((item) => item.id), ["outside-month", "year-2026", "year-2025", "legacy"]);

  const june2026 = await (await request("/api/catalog-programs?category=business&supportYear=2026&startMonth=6&endMonth=6&limit=1&offset=0")).json();
  assert.equal(june2026.total, 1);
  assert.deepEqual(june2026.items.map((item) => item.id), ["year-2026"]);

  assert.equal((await request("/api/catalog-programs?category=business&startMonth=7&endMonth=6")).status, 400);
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
      programs: [{ ...draft.programs[0], id: "cert-1", category: "certification" }],
    }),
  });
  assert.equal(standardCertification.status, 400);
  assert.equal(DB.rows.length, 0);

  const premiumCertification = await request("/api/roadmaps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...draft,
      tier: "premium",
      programs: [{ ...draft.programs[0], id: "cert-1", category: "certification" }],
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
  await access(new URL("../dist/.openai/drizzle/meta/_journal.json", import.meta.url));
  const migration = await readFile(new URL("../drizzle/0003_saved_roadmaps_tier.sql", import.meta.url), "utf8");
  assert.match(migration, /ADD COLUMN tier TEXT NOT NULL DEFAULT 'premium'/);
  assert.match(migration, /CHECK \(tier IN \('premium', 'standard'\)\)/);
  const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  assert.equal(journal.entries.filter((entry) => entry.tag === "0003_saved_roadmaps_tier").length, 1);
  assert.equal(journal.entries.filter((entry) => entry.tag === "0006_catalog_business_subcategories").length, 1);
  const server = await readFile(new URL("../dist/server/index.js", import.meta.url), "utf8");
  assert.deepEqual(server.match(/^export /gm), ["export "]);
});
