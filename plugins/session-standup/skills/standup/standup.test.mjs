/*
 * Regression tests for standup.mjs. Run with `node --test` from this directory.
 *
 * No dependencies, matching the script's own zero-dependency stance. Fixtures
 * are generated into a temp CLAUDE_CONFIG_DIR rather than committed, so they
 * cannot drift from the shapes the tests describe.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "standup.mjs");

// ------------------------------------------------------------------ fixtures

const at = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const MINUTE = 60_000;

const title = (aiTitle) => ({ type: "ai-title", aiTitle });

const userText = (uuid, parentUuid, text, msAgo) => ({
  type: "user",
  uuid,
  parentUuid,
  timestamp: at(msAgo),
  cwd: "/tmp/proj",
  message: { role: "user", content: [{ type: "text", text }] },
});

const userToolResult = (uuid, parentUuid, msAgo) => ({
  type: "user",
  uuid,
  parentUuid,
  timestamp: at(msAgo),
  cwd: "/tmp/proj",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
});

const assistantText = (uuid, parentUuid, text, msAgo) => ({
  type: "assistant",
  uuid,
  parentUuid,
  timestamp: at(msAgo),
  cwd: "/tmp/proj",
  message: { role: "assistant", content: [{ type: "text", text }] },
});

const assistantBash = (uuid, parentUuid, command, msAgo) => ({
  type: "assistant",
  uuid,
  parentUuid,
  timestamp: at(msAgo),
  cwd: "/tmp/proj",
  message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command } }] },
});

const assistantEdit = (uuid, parentUuid, filePath, msAgo) => ({
  type: "assistant",
  uuid,
  parentUuid,
  timestamp: at(msAgo),
  cwd: "/tmp/proj",
  message: {
    role: "assistant",
    content: [{ type: "tool_use", name: "Edit", input: { file_path: filePath } }],
  },
});

/* Write a CLAUDE_CONFIG_DIR containing one .jsonl per named session. */
function makeStore(sessions) {
  const root = mkdtempSync(join(tmpdir(), "standup-test-"));
  const dir = join(root, "projects", "-tmp-proj");
  mkdirSync(dir, { recursive: true });
  for (const [name, records] of Object.entries(sessions))
    writeFileSync(join(dir, `${name}.jsonl`), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return root;
}

const runRaw = (root, args) =>
  execFileSync("node", [SCRIPT, "--no-git", ...args], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: root },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

const runJson = (root, args = []) =>
  JSON.parse(runRaw(root, ["--format", "json", "--since", "1d", ...args]));

const allPrompts = (report) => report.sessions.flatMap((s) => s.prompts);

// --------------------------------------------------------- output integrity

test("piped output is not truncated and stays parseable", () => {
  // Enough content to exceed one 65,536-byte pipe buffer, which is where
  // process.exit() used to sever the stream. Per-session size is capped by
  // prompt and summary truncation, so the volume has to come from breadth.
  const sessions = {};
  for (let i = 0; i < 60; i++) {
    sessions[`bulk${i}`] = [
      title(`session ${i}`),
      ...Array.from({ length: 10 }, (_, j) =>
        userText(`u${i}-${j}`, `p${i}-${j}`, `question ${j} of session ${i} `.repeat(12), (30 - j * 0.1) * MINUTE)
      ),
      assistantText(`s${i}`, `u${i}-0`, `answer ${i} `.repeat(200), 20 * MINUTE),
    ];
  }
  const root = makeStore(sessions);

  const viaPipe = runRaw(root, ["--format", "json", "--since", "1d", "--max-bytes", "0"]);

  const outPath = join(root, "out.json");
  const fileDescriptor = openSync(outPath, "w");
  execFileSync("node", [SCRIPT, "--no-git", "--format", "json", "--since", "1d", "--max-bytes", "0"], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: root },
    stdio: ["ignore", fileDescriptor, "pipe"],
  });
  closeSync(fileDescriptor);
  const viaFile = readFileSync(outPath, "utf8");

  assert.ok(viaFile.length > 65536, `fixture too small to exercise the bug (${viaFile.length}B)`);
  assert.equal(viaPipe.length, viaFile.length, "piped output differs in length from file output");
  assert.doesNotThrow(() => JSON.parse(viaPipe), "piped JSON did not parse");
});

test("exit codes", () => {
  const root = makeStore({ s: [title("t"), userText("u", "a", "hello", 30 * MINUTE)] });
  const status = (args) =>
    spawnSync("node", [SCRIPT, ...args], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: root },
      encoding: "utf8",
    });

  assert.equal(status(["--since", "1d", "--no-git"]).status, 0, "successful run");
  assert.equal(status(["--help"]).status, 0, "help");
  assert.equal(status(["--since", "nonsense"]).status, 1, "bad --since");
  assert.equal(status(["--format", "yaml"]).status, 1, "bad --format");
  assert.equal(status(["--max-bytes", "-4"]).status, 1, "bad --max-bytes");
  assert.equal(status(["--since", "1d", "--until", "2000-01-01"]).status, 1, "inverted window");

  const failed = status(["--since", "nonsense"]);
  assert.match(failed.stderr, /cannot parse --since/, "diagnostic reached stderr");
});

test("an empty window is a well-formed empty report", () => {
  const root = makeStore({ s: [title("t"), userText("u", "a", "hello", 30 * MINUTE)] });
  const report = runJson(root, ["--project", "no-such-project"]);
  assert.equal(report.totals.sessions, 0);
  assert.deepEqual(report.sessions, []);
  assert.match(runRaw(root, ["--format", "text", "--since", "1d", "--project", "nope"]), /No Claude Code activity/);
});

// ------------------------------------------------------------ prompt capture

test("slash-command arguments are captured, expansions are not", () => {
  const root = makeStore({
    typed: [
      title("typed command"),
      // The command envelope, and its same-timestamp expansion child.
      {
        type: "user",
        uuid: "cmd1",
        parentUuid: "root",
        timestamp: at(30 * MINUTE),
        cwd: "/tmp/proj",
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "<command-message>docs:search</command-message>\n" +
                "<command-name>/docs:search</command-name>\n" +
                "<command-args>https://github.com/acme/widgets/pull/42 needs review</command-args>",
            },
          ],
        },
      },
      userText("exp1", "cmd1", "Search the documentation index. Be thorough.".repeat(30), 30 * MINUTE),
      userText("real1", "exp1", "actually check the auth path first", 25 * MINUTE),
    ],
  });

  const report = runJson(root);
  const prompts = allPrompts(report);

  assert.ok(
    prompts.some((p) => p.startsWith("/docs:search") && p.includes("needs review")),
    "command args should be captured and attributed"
  );
  assert.ok(!prompts.some((p) => p.includes("Search the documentation index")), "expansion should be dropped");
  assert.ok(prompts.includes("actually check the auth path first"), "genuine follow-up kept");
  assert.deepEqual(report.sessions[0].slash_commands, ["/docs:search"]);
  assert.deepEqual(report.references.prs, ["acme/widgets#42"], "refs extracted from args");
  assert.equal(report.sessions[0].prompt_count, 2, "expansion not counted");
});

test("a model-invoked skill prompt is dropped, even stamped before its parent", () => {
  const root = makeStore({
    invoked: [
      title("model invoked"),
      userToolResult("tr1", "a1", 30 * MINUTE),
      // 3ms EARLIER than its parent, as the real harness emits it.
      userText("exp1", "tr1", "Propose a new change - create the change".repeat(30), 30 * MINUTE - 3),
      // A genuine prompt after the same tool result, well outside the window.
      userText("real1", "tr1", "what about the mock jobs?", 20 * MINUTE),
    ],
  });

  const prompts = allPrompts(runJson(root));
  assert.ok(!prompts.some((p) => p.includes("Propose a new change")), "skill prompt dropped");
  assert.ok(prompts.includes("what about the mock jobs?"), "later genuine prompt kept");
});

test("noise envelopes never become prompts", () => {
  const root = makeStore({
    noisy: [
      title("noisy"),
      userText("n1", "a1", "<task-notification>\n<task-id>abc</task-id>\ndone\n</task-notification>", 30 * MINUTE),
      userText("n2", "n1", "<local-command-stdout>Set model to Opus</local-command-stdout>", 29 * MINUTE),
      userText("n3", "n2", "<system-reminder>remember this</system-reminder>", 28 * MINUTE),
      userText("n4", "n3", "[Request interrupted by user]", 27 * MINUTE),
      userText("n5", "n4", "a real question", 26 * MINUTE),
    ],
  });
  assert.deepEqual(allPrompts(runJson(root)), ["a real question"]);
});

// ------------------------------------------------------------------ sessions

test("trivial sessions are excluded but counted", () => {
  const root = makeStore({
    empty1: [
      {
        type: "user",
        uuid: "c1",
        parentUuid: null,
        timestamp: at(30 * MINUTE),
        cwd: "/tmp/proj",
        message: { role: "user", content: [{ type: "text", text: "<command-name>/clear</command-name>" }] },
      },
    ],
    empty2: [
      {
        type: "user",
        uuid: "c2",
        parentUuid: null,
        timestamp: at(29 * MINUTE),
        cwd: "/tmp/proj",
        message: { role: "user", content: [{ type: "text", text: "<command-name>/clear</command-name>" }] },
      },
    ],
    real: [title("real work"), userText("u1", "a1", "fix the thing", 28 * MINUTE)],
    artifacts: [assistantEdit("e1", "a1", "/tmp/proj/src/index.ts", 27 * MINUTE)],
  });

  const report = runJson(root);
  assert.equal(report.totals.trivial_sessions, 2, "two /clear-only sessions counted");
  assert.equal(report.totals.sessions, 2, "one titled + one artifact-only session kept");
  assert.equal(report.sessions.length, report.totals.sessions);
  assert.ok(
    report.sessions.some((s) => s.files_touched.includes("src/index.ts")),
    "a session evidenced only by files is not trivial"
  );
});

test("git operations are parsed from the invocation forms in use", () => {
  const forms = [
    ['git commit -m "plain message"', "plain message"],
    ['git -C /some/repo commit -m "scoped message"', "scoped message"],
    ['git commit -am "combined flags"', "combined flags"],
    ['git commit --message="equals form"', "equals form"],
    ['git commit -m "$(cat <<EOF\nheredoc subject\n\nCo-Authored-By: someone\nEOF\n)"', "heredoc subject"],
  ];
  const sessions = {};
  forms.forEach(([command], i) => {
    sessions[`g${i}`] = [title(`git ${i}`), assistantBash(`b${i}`, `a${i}`, command, 30 * MINUTE)];
  });
  const report = runJson(makeStore(sessions));
  const ops = report.sessions.flatMap((s) => s.git_ops);

  for (const [, expected] of forms)
    assert.ok(ops.includes(`commit: ${expected}`), `missing commit op for "${expected}" (got ${JSON.stringify(ops)})`);
});

test("references exclude placeholders and unqualified numbers", () => {
  const root = makeStore({
    refs: [
      title("refs"),
      userText("u1", "a1", "see https://github.com/org/repo/pull/4648 in the docs", 30 * MINUTE),
      userText("u2", "u1", "real one https://github.com/acme/widgets/pull/7", 29 * MINUTE),
      userText("u3", "u2", "check PR #4645 please", 28 * MINUTE),
      userText("u4", "u3", "the value at line #123 is wrong", 27 * MINUTE),
      userText("u5", "u4", "colour #1E3A8A everywhere", 26 * MINUTE),
    ],
  });
  const report = runJson(root);
  assert.deepEqual(report.references.prs, ["acme/widgets#7"], "placeholder repo excluded");
  assert.ok(report.references.mentions.includes("#4645"), "qualified bare number kept");
  assert.ok(!report.references.mentions.includes("#123"), "unqualified bare number dropped");
  assert.ok(!report.references.mentions.includes("#1E3"), "hex colour is not a reference");
});

// ----------------------------------------------------------------- redaction

test("redaction table: secrets go, prose stays", () => {
  const cases = [
    ["SERVICE_MANAGEMENT_TOKEN=8f3aKd0zLmQ1pXyZ7bR2tE", true, "prefixed label"],
    ["export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", true, "mid-identifier"],
    ["SERVICE_AUTH_TOKEN: 8f3aKd0zLmQ1pXyZ7bR2tE", true, "colon separator"],
    ["--secret-key 9f8e7d6c5b4a3210ffff", true, "dash-led flag"],
    ["NEXT_PUBLIC_SERVICE_ACCESS_TOKEN=aBcD1234efGH5678ijKL", true, "long prefix chain"],
    ["password: correct-horse-battery", true, "plain label"],
    ["ghp_abcdefghijklmnopqrstuvwxyz0123", true, "github token"],
    ["postgres://user:hunter2@db.internal:5432/app", true, "url credentials"],
    ["ssh to 10.129.4.7", true, "private ip"],
    ["deploy target is 192.168.1.50", true, "192.168 range"],
    ["Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcd", true, "jwt"],
    ["the token is documented in the readme", false, "prose: token"],
    ["password reset flow is broken", false, "prose: password"],
    ["secret sauce implementation detail", false, "prose: secret"],
    ["non-secret-related refactoring work", false, "prose: hyphenated"],
    ["GITHUB_TOKEN=${{ secrets.GITHUB_TOKEN }}", false, "template reference"],
    ["tokenizer.encode(some_long_string_here)", false, "identifier starting with token"],
    ["upgrade to v10.129.0.1 of the lib", false, "version string"],
  ];

  // One session per case, so nothing is trimmed and each prompt is addressable.
  const sessions = {};
  cases.forEach(([text], i) => {
    sessions[`c${String(i).padStart(2, "0")}`] = [
      title(`case-${i}`),
      userText(`u${i}`, `a${i}`, text, (30 - i * 0.1) * MINUTE),
    ];
  });
  const report = runJson(makeStore(sessions), ["--max-bytes", "0"]);
  const byTitle = new Map(report.sessions.map((s) => [s.title, s.prompts[0]]));

  cases.forEach(([text, shouldRedact, label], i) => {
    const got = byTitle.get(`case-${i}`);
    assert.ok(got !== undefined, `${label}: prompt missing`);
    if (shouldRedact) assert.notEqual(got, text, `${label}: should have been redacted`);
    else assert.equal(got, text, `${label}: should have been left alone`);
  });
});

test("--no-redact is an explicit opt-out", () => {
  const secret = "SERVICE_MANAGEMENT_TOKEN=8f3aKd0zLmQ1pXyZ7bR2tE";
  const root = makeStore({ s: [title("t"), userText("u", "a", secret, 30 * MINUTE)] });

  const redacted = runJson(root);
  assert.equal(redacted.redacted, true);
  assert.ok(!allPrompts(redacted)[0].includes("8f3aKd0z"));

  const raw = runJson(root, ["--no-redact"]);
  assert.equal(raw.redacted, false);
  assert.equal(allPrompts(raw)[0], secret);
});

test("a secret beyond the truncation limit leaves no fragment", () => {
  const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
  const root = makeStore({
    s: [title("t"), userText("u", "a", `${"padding words ".repeat(40)}${secret}`, 30 * MINUTE)],
  });
  const prompt = allPrompts(runJson(root))[0];
  assert.ok(!prompt.includes("ghp_"), "no fragment of the token survived truncation");
});

// -------------------------------------------------------------- size budget

const bulkStore = () => {
  const sessions = {};
  for (let i = 0; i < 40; i++) {
    sessions[`b${i}`] = [
      title(`session ${i}`),
      ...Array.from({ length: 12 }, (_, j) =>
        userText(`u${i}-${j}`, `p${i}-${j}`, `prompt ${j} in session ${i} `.repeat(6), (30 - j * 0.1) * MINUTE)
      ),
      assistantText(`s${i}`, `u${i}-0`, `closing summary ${i} `.repeat(60), 20 * MINUTE),
    ];
  }
  return makeStore(sessions);
};

test("an over-budget report sheds detail and announces every step", () => {
  const root = bulkStore();
  const unbudgeted = runJson(root, ["--max-bytes", "0"]);
  const budgeted = runJson(root, ["--max-bytes", "40000"]);

  const shedNotes = budgeted.warnings.filter((w) => /max-bytes/.test(w));
  assert.ok(shedNotes.length > 0, "reductions must be announced");
  assert.ok(
    JSON.stringify(budgeted).length < JSON.stringify(unbudgeted).length,
    "budgeted report should be smaller"
  );
  assert.equal(budgeted.totals.sessions, unbudgeted.totals.sessions, "no session may be dropped to fit");
  assert.ok(
    budgeted.sessions.every((s) => s.transcript === undefined),
    "transcript paths shed first"
  );
});

test("--max-bytes 0 disables budgeting entirely", () => {
  const report = runJson(bulkStore(), ["--max-bytes", "0"]);
  assert.equal(report.warnings.filter((w) => /max-bytes/.test(w)).length, 0);
  assert.ok(report.sessions.every((s) => s.transcript !== undefined), "nothing shed");
});

test("a report that cannot fit is emitted whole, with a warning", () => {
  const report = runJson(bulkStore(), ["--max-bytes", "500"]);
  const overflow = report.warnings.find((w) => /over --max-bytes/.test(w));
  assert.ok(overflow, "overflow must be reported");
  assert.ok(JSON.stringify(report).length > 500, "the report is emitted in full rather than cut");
  assert.equal(report.sessions.length, 40, "all sessions still present");
});

test("a report already within budget is untouched", () => {
  const root = makeStore({ s: [title("small"), userText("u", "a", "tiny", 30 * MINUTE)] });
  const report = runJson(root);
  assert.equal(report.warnings.filter((w) => /max-bytes/.test(w)).length, 0);
  assert.ok(report.sessions[0].transcript !== undefined);
});
