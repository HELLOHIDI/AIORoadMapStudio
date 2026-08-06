import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
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
  return {
    rows,
    prepare(sql) {
      const statement = sql.replace(/\s+/g, " ").trim();
      return {
        bind(...params) {
          return {
            async all() {
              const hasSearch = statement.includes("title LIKE");
              const hasCategory = statement.includes("category = ?");
              const query = hasSearch ? String(params[0]).slice(1, -1).toLowerCase() : "";
              const category = hasCategory ? params[hasSearch ? 3 : 0] : "";
              const pageParams = params.slice((hasSearch ? 3 : 0) + (hasCategory ? 1 : 0));
              const [limit, offset] = pageParams;
              const items = rows
                .filter((row) => !query || [row.title, row.target, row.details]
                  .some((value) => value.toLowerCase().includes(query)))
                .filter((row) => !category || row.category === category)
                .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))
                .slice(offset, offset + limit);
              return { results: items };
            },
            async first() {
              const hasSearch = statement.includes("title LIKE");
              const hasCategory = statement.includes("category = ?");
              const query = hasSearch ? String(params[0]).slice(1, -1).toLowerCase() : "";
              const category = hasCategory ? params[hasSearch ? 3 : 0] : "";
              return {
                total: rows.filter((row) => !query || [row.title, row.target, row.details]
                  .some((value) => value.toLowerCase().includes(query)))
                  .filter((row) => !category || row.category === category).length,
              };
            },
            async run() {
              if (statement.startsWith("INSERT")) {
                const [id, category, title, link, amountKrw, startMonth, endMonth, target, details, industriesJson, regionsJson, createdAt, updatedAt] = params;
                rows.push({ id, category, title, link, amountKrw, startMonth, endMonth, target, details, industriesJson, regionsJson, createdAt, updatedAt });
                return { meta: { changes: 1 } };
              }
              if (statement.startsWith("UPDATE")) {
                const [category, title, link, amountKrw, startMonth, endMonth, target, details, industriesJson, regionsJson, updatedAt, id] = params;
                const row = rows.find((item) => item.id === id);
                if (!row) return { meta: { changes: 0 } };
                Object.assign(row, { category, title, link, amountKrw, startMonth, endMonth, target, details, industriesJson, regionsJson, updatedAt });
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
                  .map(({ id, clientName, createdAt, updatedAt }) => ({ id, clientName, createdAt, updatedAt })),
              };
            },
            async first() {
              if (statement.startsWith("SELECT COUNT")) return { total: rows.length };
              return rows.find((item) => item.id === params[0]) ?? null;
            },
            async run() {
              if (statement.startsWith("INSERT")) {
                const [id, clientName, documentJson, createdAt, updatedAt] = params;
                rows.push({ id, clientName, documentJson, createdAt, updatedAt });
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
  industries: ["해양", "해양수산"],
  regions: ["서울", "부산"],
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
    body: JSON.stringify({ ...catalogInput, title: "수정된 사업" }),
  });
  assert.equal(updatedResponse.status, 200);
  assert.equal(DB.rows[0].title, "수정된 사업");

  const deletedResponse = await request(`/api/catalog-programs/${created.item.id}`, { method: "DELETE" });
  assert.equal(deletedResponse.status, 200);
  assert.equal(DB.rows.length, 0);
});

test("persists public roadmap drafts without applying PDF validity rules", async () => {
  const DB = createRoadmapDatabase();
  const env = { DB };
  const request = (path, options) => worker.fetch(new Request(`https://example.test${path}`, options), env);
  const draft = {
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
  assert.equal(DB.rows.length, 1);

  const listResponse = await request("/api/roadmaps?limit=50&offset=0");
  const list = await listResponse.json();
  assert.equal(list.total, 1);
  assert.equal(list.items[0].id, created.item.id);
  assert.equal(Object.hasOwn(list.items[0], "document"), false);

  const openedResponse = await request(`/api/roadmaps/${created.item.id}`);
  const opened = await openedResponse.json();
  assert.deepEqual(opened.item.document, draft);

  const updatedDraft = { ...draft, clientName: "수정 중인 고객" };
  const updatedResponse = await request(`/api/roadmaps/${created.item.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(updatedDraft),
  });
  const updated = await updatedResponse.json();
  assert.equal(updatedResponse.status, 200);
  assert.deepEqual(updated.item.document, updatedDraft);

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

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
  await access(new URL("../dist/.openai/drizzle/0000_catalog_programs.sql", import.meta.url));
  await access(new URL("../dist/.openai/drizzle/0001_saved_roadmaps.sql", import.meta.url));
  await access(new URL("../dist/.openai/drizzle/meta/_journal.json", import.meta.url));
  const server = await readFile(new URL("../dist/server/index.js", import.meta.url), "utf8");
  assert.deepEqual(server.match(/^export /gm), ["export "]);
});
