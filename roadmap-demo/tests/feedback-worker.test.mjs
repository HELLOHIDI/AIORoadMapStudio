import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";

function createFeedbackDatabase() {
  const roadmaps = [];
  const feedback = [];
  const events = [];
  const sessions = [];
  const attempts = [];
  return {
    roadmaps,
    feedback,
    events,
    sessions,
    attempts,
    async batch(statements) {
      const snapshot = structuredClone({ roadmaps, feedback, events, sessions, attempts });
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        return results;
      } catch (error) {
        for (const [rows, savedRows] of [[roadmaps, snapshot.roadmaps], [feedback, snapshot.feedback], [events, snapshot.events], [sessions, snapshot.sessions], [attempts, snapshot.attempts]]) {
          rows.splice(0, rows.length, ...savedRows);
        }
        throw error;
      }
    },
    prepare(sql) {
      const statement = sql.replace(/\s+/g, " ").trim();
      return {
        bind(...params) {
          return {
            async all() {
              if (statement.startsWith("SELECT id, updated_at AS updatedAt FROM roadmap_feedback WHERE roadmap_id = ? AND status = ?")) {
                return {
                  results: feedback
                    .filter((row) => row.roadmapId === params[0] && row.status === params[1])
                    .map((row) => ({ id: row.id, updatedAt: row.updatedAt })),
                };
              }
              if (statement.startsWith("SELECT id, program_id AS programId")) {
                const roadmapId = params[0];
                return {
                  results: feedback
                    .filter((row) => row.roadmapId === roadmapId)
                    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))
                    .map((row) => ({
                      id: row.id,
                      programId: row.programId,
                      status: row.status,
                      createdAt: row.createdAt,
                      updatedAt: row.updatedAt,
                    })),
                };
              }
              if (statement.startsWith("SELECT id, feedback_id AS feedbackId")) {
                const ids = params;
                return {
                  results: events
                    .filter((row) => ids.includes(row.feedbackId))
                    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
                    .map((row) => ({
                      id: row.id,
                      feedbackId: row.feedbackId,
                      type: row.type,
                      role: row.role,
                      text: row.text,
                      createdAt: row.createdAt,
                    })),
                };
              }
              if (statement.startsWith("SELECT kind, value FROM catalog_options")) {
                return { results: [] };
              }
              throw new Error(`Unsupported all: ${statement}`);
            },
            async first() {
              if (statement.startsWith("SELECT name FROM sqlite_master")) {
                return { name: "roadmap_feedback" };
              }
              if (statement.startsWith("SELECT tier, document_json AS documentJson FROM roadmaps")) {
                const row = roadmaps.find((item) => item.id === params[0]);
                return row ? { tier: row.tier, documentJson: row.documentJson } : null;
              }
              if (statement.startsWith("SELECT tier FROM roadmaps")) {
                const row = roadmaps.find((item) => item.id === params[0]);
                return row ? { tier: row.tier } : null;
              }
              if (statement.startsWith("SELECT id FROM roadmaps")) {
                const row = roadmaps.find((item) => item.id === params[0]);
                return row ? { id: row.id } : null;
              }
              if (statement.startsWith("SELECT id FROM roadmap_feedback")) {
                const row = feedback.find((item) => item.roadmapId === params[0] && item.programId === params[1]);
                return row ? { id: row.id } : null;
              }
              if (statement.startsWith("SELECT id, status, updated_at AS updatedAt FROM roadmap_feedback")) {
                const row = feedback.find((item) => item.roadmapId === params[0] && item.programId === params[1]);
                return row ? { id: row.id, status: row.status, updatedAt: row.updatedAt } : null;
              }
              if (statement.startsWith("SELECT id, program_id AS programId")) {
                const row = feedback.find((item) => item.roadmapId === params[0] && item.programId === params[1]);
                return row ? {
                  id: row.id,
                  programId: row.programId,
                  status: row.status,
                  createdAt: row.createdAt,
                  updatedAt: row.updatedAt,
                } : null;
              }
              if (statement.startsWith("SELECT token_hash AS tokenHash")) {
                const row = sessions.find((item) => item.tokenHash === params[0] && item.secretVersion === params[1] && item.expiresAt > params[2]);
                return row ? { tokenHash: row.tokenHash } : null;
              }
              if (statement.startsWith("SELECT count, window_start AS windowStart, locked_until AS lockedUntil")) {
                const row = attempts.find((item) => item.attemptKey === params[0]);
                return row ? { count: row.count, windowStart: row.windowStart, lockedUntil: row.lockedUntil } : null;
              }
              if (statement.startsWith("SELECT count, window_start AS windowStart FROM feedback_auth_attempts")) {
                const row = attempts.find((item) => item.attemptKey === params[0]);
                return row ? { count: row.count, windowStart: row.windowStart } : null;
              }
              throw new Error(`Unsupported first: ${statement}`);
            },
            async run() {
              if (statement.startsWith("INSERT OR IGNORE INTO roadmap_feedback ")) {
                const [id, roadmapId, programId, status, createdAt, updatedAt] = params;
                if (feedback.some((item) => item.roadmapId === roadmapId && item.programId === programId)) return { meta: { changes: 0 } };
                feedback.push({ id, roadmapId, programId, status, createdAt, updatedAt });
                return { meta: { changes: 1 } };
              }
              if (statement.startsWith("UPDATE roadmap_feedback SET status")) {
                const [status, updatedAt, id] = params;
                const row = feedback.find((item) => item.id === id);
                if (!row) return { meta: { changes: 0 } };
                if (statement.includes("AND status = 'completed'") && row.status !== "completed") return { meta: { changes: 0 } };
                Object.assign(row, { status, updatedAt });
                return { meta: { changes: 1 } };
              }
              if (statement.startsWith("INSERT INTO roadmap_feedback_events")) {
                const [id, feedbackId, type, role, text, createdAt] = params;
                events.push({ id, feedbackId, type, role, text, createdAt });
                return { meta: { changes: 1 } };
              }
              if (statement.startsWith("DELETE FROM roadmap_feedback WHERE roadmap_id = ? AND program_id NOT IN")) {
                const [roadmapId, ...programIds] = params;
                const before = feedback.length;
                for (let index = feedback.length - 1; index >= 0; index -= 1) {
                  if (feedback[index].roadmapId === roadmapId && !programIds.includes(feedback[index].programId)) feedback.splice(index, 1);
                }
                return { meta: { changes: before - feedback.length } };
              }
              if (statement.startsWith("DELETE FROM roadmap_feedback WHERE roadmap_id")) {
                const before = feedback.length;
                for (let index = feedback.length - 1; index >= 0; index -= 1) {
                  if (feedback[index].roadmapId === params[0]) feedback.splice(index, 1);
                }
                return { meta: { changes: before - feedback.length } };
              }
              if (statement.startsWith("DELETE FROM roadmaps")) {
                const index = roadmaps.findIndex((item) => item.id === params[0]);
                if (index === -1) return { meta: { changes: 0 } };
                roadmaps.splice(index, 1);
                return { meta: { changes: 1 } };
              }
              if (statement.startsWith("UPDATE roadmaps SET client_name")) {
                const [clientName, documentJson, updatedAt, id] = params;
                const row = roadmaps.find((item) => item.id === id);
                if (!row) return { meta: { changes: 0 } };
                Object.assign(row, { clientName, documentJson, updatedAt });
                return { meta: { changes: 1 } };
              }
              if (statement.startsWith("DELETE FROM feedback_auth_sessions WHERE expires_at")) {
                for (let index = sessions.length - 1; index >= 0; index -= 1) {
                  if (sessions[index].expiresAt <= params[0]) sessions.splice(index, 1);
                }
                return { meta: { changes: 1 } };
              }
              if (statement.startsWith("DELETE FROM feedback_auth_sessions WHERE token_hash")) {
                const index = sessions.findIndex((item) => item.tokenHash === params[0]);
                if (index !== -1) sessions.splice(index, 1);
                return { meta: { changes: index === -1 ? 0 : 1 } };
              }
              if (statement.startsWith("INSERT INTO feedback_auth_sessions")) {
                const [tokenHash, secretVersion, createdAt, expiresAt] = params;
                sessions.push({ tokenHash, secretVersion, createdAt, expiresAt });
                return { meta: { changes: 1 } };
              }
              if (statement.startsWith("DELETE FROM feedback_auth_attempts")) {
                const index = attempts.findIndex((item) => item.attemptKey === params[0]);
                if (index !== -1) attempts.splice(index, 1);
                return { meta: { changes: index === -1 ? 0 : 1 } };
              }
              if (statement.startsWith("INSERT OR REPLACE INTO feedback_auth_attempts")) {
                const [attemptKey, count, windowStart, lockedUntil] = params;
                const index = attempts.findIndex((item) => item.attemptKey === attemptKey);
                const row = { attemptKey, count, windowStart, lockedUntil };
                if (index === -1) attempts.push(row);
                else attempts[index] = row;
                return { meta: { changes: 1 } };
              }
              if (statement.startsWith("UPDATE feedback_auth_attempts")) {
                const [count, lockedUntil, attemptKey] = params;
                const row = attempts.find((item) => item.attemptKey === attemptKey);
                if (!row) return { meta: { changes: 0 } };
                Object.assign(row, { count, lockedUntil });
                return { meta: { changes: 1 } };
              }
              throw new Error(`Unsupported run: ${statement}`);
            },
          };
        },
      };
    },
  };
}

function seedRoadmap(DB) {
  const document = {
    tier: "premium",
    clientName: "Client",
    programs: [
      { id: "program-1", category: "business", title: "Program", sequence: 0 },
      { id: "program-2", category: "voucher", title: "Program 2", sequence: 1 },
    ],
  };
  DB.roadmaps.push({
    id: "roadmap-1",
    tier: "premium",
    documentJson: JSON.stringify(document),
  });
  return document;
}

async function request(env, path, options) {
  return worker.fetch(new Request(`https://example.test${path}`, options), env);
}

test("feedback password endpoint is removed", async () => {
  const DB = createFeedbackDatabase();
  const response = await request({ DB }, "/api/feedback-auth/session", {
    method: "POST",
    headers: { "content-type": "application/json", "x-aio-feedback-action": "1" },
    body: JSON.stringify({ password: "unused" }),
  });
  assert.equal(response.status, 404);
});

test("feedback lifecycle is keyed by roadmap and program stable ids", async () => {
  const DB = createFeedbackDatabase();
  const document = seedRoadmap(DB);
  const env = { DB };
  const originalDocumentJson = DB.roadmaps[0].documentJson;

  const missingProgram = await request(env, "/api/roadmaps/roadmap-1/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", "x-aio-feedback-action": "1" },
    body: JSON.stringify({ programId: "missing", text: "Missing program" }),
  });
  assert.equal(missingProgram.status, 404);
  assert.equal(DB.roadmaps[0].documentJson, originalDocumentJson);

  const createdResponse = await request(env, "/api/roadmaps/roadmap-1/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", "x-aio-feedback-action": "1" },
    body: JSON.stringify({ programId: "program-1", text: "Fix eligibility wording" }),
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 201);
  assert.equal(created.item.programId, "program-1");
  assert.equal(created.item.status, "needs_changes");
  assert.deepEqual(created.item.events.map((event) => [event.type, event.role, event.text]), [
    ["comment", "lead", "Fix eligibility wording"],
  ]);

  const duplicate = await request(env, "/api/roadmaps/roadmap-1/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", "x-aio-feedback-action": "1" },
    body: JSON.stringify({ programId: "program-1", text: "Duplicate thread" }),
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error, "FEEDBACK_ALREADY_EXISTS");

  const earlyResolve = await request(env, "/api/roadmaps/roadmap-1/feedback/program-1", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-aio-feedback-action": "1" },
    body: JSON.stringify({ action: "resolve" }),
  });
  assert.equal(earlyResolve.status, 409);

  const completedResponse = await request(env, "/api/roadmaps/roadmap-1/feedback/program-1", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-aio-feedback-action": "1" },
    body: JSON.stringify({ action: "complete", text: "Updated copy" }),
  });
  assert.equal(completedResponse.status, 200);
  assert.equal((await completedResponse.json()).item.status, "completed");

  const emptyRework = await request(env, "/api/roadmaps/roadmap-1/feedback/program-1", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-aio-feedback-action": "1" },
    body: JSON.stringify({ action: "rework" }),
  });
  assert.equal(emptyRework.status, 400);

  const reworkResponse = await request(env, "/api/roadmaps/roadmap-1/feedback/program-1", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-aio-feedback-action": "1" },
    body: JSON.stringify({ action: "rework", text: "One more pass" }),
  });
  assert.equal((await reworkResponse.json()).item.status, "needs_changes");

  const completedAgain = await request(env, "/api/roadmaps/roadmap-1/feedback/program-1", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-aio-feedback-action": "1" },
    body: JSON.stringify({ action: "complete", text: "Updated again" }),
  });
  assert.equal((await completedAgain.json()).item.status, "completed");

  const resolvedResponse = await request(env, "/api/roadmaps/roadmap-1/feedback/program-1", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-aio-feedback-action": "1" },
    body: JSON.stringify({ action: "resolve", text: "Looks good" }),
  });
  assert.equal((await resolvedResponse.json()).item.status, "resolved");

  const repeatedResolve = await request(env, "/api/roadmaps/roadmap-1/feedback/program-1", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-aio-feedback-action": "1" },
    body: JSON.stringify({ action: "resolve" }),
  });
  assert.equal(repeatedResolve.status, 409);

  const list = await (await request(env, "/api/roadmaps/roadmap-1/feedback")).json();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].programId, document.programs[0].id);
  assert.deepEqual(list.items[0].events.map((event) => [event.type, event.role, event.text]), [
    ["comment", "lead", "Fix eligibility wording"],
    ["completed", "assignee", "Updated copy"],
    ["rework", "lead", "One more pass"],
    ["completed", "assignee", "Updated again"],
    ["resolved", "lead", "Looks good"],
  ]);
});

test("bulk resolution includes roadmap and category feedback, but only completed threads", async () => {
  const DB = createFeedbackDatabase();
  seedRoadmap(DB);
  const env = { DB };
  const headers = { "content-type": "application/json", "x-aio-feedback-action": "1" };
  for (const [programId, text] of [["program-1", "Program"], ["category:business", "Category"], ["roadmap", "Roadmap"]]) {
    const response = await request(env, "/api/roadmaps/roadmap-1/feedback", {
      method: "POST", headers, body: JSON.stringify({ programId, text }),
    });
    assert.equal(response.status, 201);
  }
  for (const programId of ["program-1", "category:business"]) {
    const response = await request(env, `/api/roadmaps/roadmap-1/feedback/${encodeURIComponent(programId)}`, {
      method: "PATCH", headers: { "content-type": "application/json", "x-aio-feedback-action": "1" }, body: JSON.stringify({ action: "complete" }),
    });
    assert.equal(response.status, 200);
  }

  const resolved = await request(env, "/api/roadmaps/roadmap-1/feedback/resolve-completed", {
    method: "POST", headers, body: "{}",
  });
  assert.deepEqual(await resolved.json(), { resolved: 2 });
  assert.deepEqual(Object.fromEntries(DB.feedback.map((item) => [item.programId, item.status])), {
    "program-1": "resolved", "category:business": "resolved", roadmap: "needs_changes",
  });
  assert.equal(DB.events.filter((event) => event.type === "resolved" && event.role === "lead").length, 2);

  const list = await (await request(env, "/api/roadmaps/roadmap-1/feedback")).json();
  assert.deepEqual(new Set(list.items.map((item) => item.programId)), new Set(["program-1", "category:business", "roadmap"]));
});

test("feedback for a removed program is not exposed to users", async () => {
  const DB = createFeedbackDatabase();
  seedRoadmap(DB);
  const env = { DB };

  const created = await request(env, "/api/roadmaps/roadmap-1/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", "x-aio-feedback-action": "1" },
    body: JSON.stringify({ programId: "program-1", text: "Remove this orphan" }),
  });
  assert.equal(created.status, 201);

  const document = JSON.parse(DB.roadmaps[0].documentJson);
  document.programs = document.programs.filter((program) => program.id !== "program-1");
  DB.roadmaps[0].documentJson = JSON.stringify(document);

  const list = await (await request(env, "/api/roadmaps/roadmap-1/feedback")).json();
  assert.deepEqual(list.items, []);
});

test("saving a roadmap removes feedback for programs deleted from its document", async () => {
  const DB = createFeedbackDatabase();
  const document = seedRoadmap(DB);
  const env = { DB };

  const created = await request(env, "/api/roadmaps/roadmap-1/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", "x-aio-feedback-action": "1" },
    body: JSON.stringify({ programId: "program-1", text: "Remove on save" }),
  });
  assert.equal(created.status, 201);

  const savedDocument = {
    ...document,
    programs: document.programs
      .filter((program) => program.id === "program-2")
      .map((program) => ({ ...program, startMonth: 1, endMonth: 1, amountKrw: null })),
  };
  const updated = await request(env, "/api/roadmaps/roadmap-1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(savedDocument),
  });
  assert.equal(updated.status, 200);
  assert.equal(DB.feedback.length, 0);
});

test("deleting a roadmap with no feedback still reports success", async () => {
  const DB = createFeedbackDatabase();
  seedRoadmap(DB);
  const env = { DB };

  const deleted = await request(env, "/api/roadmaps/roadmap-1", { method: "DELETE" });

  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { deleted: true, id: "roadmap-1" });
  assert.equal(DB.roadmaps.length, 0);
});

test("deleting a roadmap removes its feedback without changing other roadmap JSON", async () => {
  const DB = createFeedbackDatabase();
  seedRoadmap(DB);
  DB.roadmaps.push({
    id: "roadmap-2",
    tier: "premium",
    documentJson: JSON.stringify({ tier: "premium", clientName: "Other", programs: [{ id: "program-1" }] }),
  });
  const env = { DB };

  const created = await request(env, "/api/roadmaps/roadmap-1/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", "x-aio-feedback-action": "1" },
    body: JSON.stringify({ programId: "program-1", text: "Needs cleanup" }),
  });
  assert.equal(created.status, 201);
  const otherDocumentJson = DB.roadmaps[1].documentJson;

  const deleted = await request(env, "/api/roadmaps/roadmap-1", { method: "DELETE" });
  assert.equal(deleted.status, 200);
  assert.equal(DB.roadmaps.some((row) => row.id === "roadmap-1"), false);
  assert.equal(DB.feedback.length, 0);
  assert.equal(DB.roadmaps[0].id, "roadmap-2");
  assert.equal(DB.roadmaps[0].documentJson, otherDocumentJson);
});
