"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const workerPath = path.join(__dirname, "..", "notification-worker.js");

function runWorkerWithMockDatabase(shouldFail) {
  const script = String.raw`
    const assert = require("node:assert/strict");
    const Module = require("node:module");
    const originalLoad = Module._load;
    let fakePool;

    class FakePool {
      constructor(options) {
        this.options = options;
        this.queries = [];
        this.ended = false;
        fakePool = this;
      }
      query(sql, params) {
        this.queries.push({ sql: String(sql), params });
        if (process.env.MOCK_DB_FAIL === "true") {
          return Promise.reject(new Error("mock database failure"));
        }
        return Promise.resolve({
          rows: [
            { status: "pending", channel: "sms", count: 2 },
            { status: "sent", channel: "sms", count: 4 }
          ]
        });
      }
      end() {
        this.ended = true;
        return Promise.resolve();
      }
    }

    Module._load = function(request, parent, isMain) {
      if (request === "pg") return { Pool: FakePool };
      return originalLoad.call(this, request, parent, isMain);
    };
    global.setInterval = () => ({ mockedInterval: true });
    global.clearInterval = () => {};
    process.env.DATABASE_URL = "postgres://mock.invalid/test";
    process.env.NOTIFICATION_DRY_RUN = "true";
    process.env.MOCK_DB_FAIL = ${JSON.stringify(shouldFail ? "true" : "false")};

    require(${JSON.stringify(workerPath)});

    setImmediate(() => {
      try {
        assert.ok(fakePool, "worker should initialize the mocked pool");
        assert.equal(fakePool.queries.length, 1, "dry-run should issue one query on startup");
        const sql = fakePool.queries[0].sql;
        assert.match(sql, /^SELECT\s+status,\s*channel,\s*COUNT\(\*\)::int AS count FROM notification_outbox/i);
        assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
        assert.equal(fakePool.options.connectionString, "postgres://mock.invalid/test");
        if (process.env.MOCK_DB_FAIL === "true") {
          setImmediate(() => {
            try {
              assert.equal(fakePool.ended, true, "pool should close after a failed read");
              assert.equal(process.exitCode, 1, "database failure should mark the process as failed");
              console.log("MOCK_TEST_PASS:failure");
            } catch (error) {
              console.error(error);
              process.exitCode = 2;
            }
          });
        } else {
          assert.equal(fakePool.ended, false, "successful dry-run should leave pool open for scheduled checks");
          console.log("MOCK_TEST_PASS:success");
        }
      } catch (error) {
        console.error(error);
        process.exitCode = 2;
      }
    });
  `;

  return spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    env: { ...process.env, MOCK_DB_FAIL: shouldFail ? "true" : "false" },
    timeout: 5000
  });
}

test("dry-run reads aggregate queue counts with a mocked successful database", () => {
  const result = runWorkerWithMockDatabase(false);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /MOCK_TEST_PASS:success/);
  assert.match(result.stdout, /DRY RUN queue summary/);
  assert.doesNotMatch(result.stdout, /MOCK_TEST_PASS:failure/);
});

test("dry-run closes the pool and marks failure with a mocked database error", () => {
  const result = runWorkerWithMockDatabase(true);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /MOCK_TEST_PASS:failure/);
  assert.match(result.stdout, /DRY RUN check failed/);
});
