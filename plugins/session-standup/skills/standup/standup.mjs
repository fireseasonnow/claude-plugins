#!/usr/bin/env node
/*
 * Extract a structured digest of recent Claude Code sessions for standup reports.
 *
 * Reads ~/.claude/projects/<dir>/*.jsonl (append-only session transcripts) plus
 * ~/.claude/history.jsonl, and emits JSON (default) or a compact text digest.
 *
 * Everything here is deterministic: no model calls, no network. The narration
 * happens in SKILL.md, from this output.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeSync } from "node:fs";
import { join, basename, isAbsolute, relative } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const HOME = homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(HOME, ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
const HISTORY_FILE = join(CLAUDE_DIR, "history.jsonl");

// Gaps longer than this between events are treated as "away", not work time.
const IDLE_GAP_MS = 5 * 60 * 1000;

/*
 * How close to its parent a user record must land to be harness-generated
 * rather than typed. Measured over ~6 weeks of transcripts: every injected
 * record arrived within 3ms, the fastest genuine follow-up took 6.6s. Anything
 * in this range separates them; 250ms keeps a wide margin on both sides.
 */
const HARNESS_ECHO_MS = 250;

const MAX_PROMPTS_PER_SESSION = 15;
const PROMPT_TRUNCATE = 220;
const ASSISTANT_TRUNCATE = 500;

/*
 * Output budget. Deliberately below the 65,536-byte pipe buffer: if the
 * process.exitCode fix at the bottom of this file is ever reverted, the budget
 * still keeps output under the cliff, so the two mitigations are independent.
 */
const DEFAULT_MAX_BYTES = 60000;

// Transcript noise that is machinery, not something the user said. Checked
// after tag-stripping, since most of it arrives wrapped in an XML-ish envelope.
const NOISE_PREFIXES = [
  "Caveat: The messages below",
  "[Request interrupted",
  "API Error",
  "This session is being continued from a previous",
];

// Whole-message envelopes that never contain user intent.
const NOISE_TAGS = [
  "local-command-stdout",
  "command-stdout",
  "local-command-caveat",
  "system-reminder",
  "task-notification",
];

const RE_COMMAND_NAME = /<command-name>([^<]+)<\/command-name>/;
const RE_COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;
const RE_COMMAND_MSG = /<command-message>[^<]*<\/command-message>\s*/g;
const RE_TAG = /<[^>]{1,60}>/g;

const RE_PR_URL = /github\.com\/([\w.\-]+\/[\w.\-]+)\/pull\/(\d+)/g;
const RE_ISSUE_URL = /github\.com\/([\w.\-]+\/[\w.\-]+)\/issues\/(\d+)/g;
const RE_REPO_HASH = /\b([\w.\-]+\/[\w.\-]+)#(\d+)\b/g;
const RE_BARE_HASH = /(?<![\w#/])#(\d{1,5})\b/g;
const RE_HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g;

// Repositories that only ever appear in documentation, templates and examples.
const PLACEHOLDER_REPOS = new Set([
  "org/repo",
  "owner/repo",
  "user/repo",
  "username/repo",
  "example/repo",
  "foo/bar",
]);
const isPlaceholderRepo = (repo) => {
  const name = repo.toLowerCase();
  return PLACEHOLDER_REPOS.has(name) || /^(your|my|some|example)[-_]/.test(name);
};

/*
 * A bare #123 is only an issue reference if something nearby says so. Without
 * this gate the mentions list fills with line numbers and ids — a two-week
 * window produced #1, #16, #123, #41282 and #96742, none of them references.
 */
const RE_ISSUE_CONTEXT = /\b(prs?|pull|issues?|tickets?|fix(?:es|ed)?|closes?|resolves?)\b/i;
const ISSUE_CONTEXT_RADIUS = 40;
const RE_IMAGE_REF = /\[Image(?:\s*#\d+)?[^\]]*\]/g;
const RE_IMAGE_SOURCE = /^\[Image:\s*source:[\s\S]*\]$/;

/*
 * Tolerates pre-subcommand globals (`git -C /path commit`), combined short
 * flags (`-am`), and `--message=`. The bounded gap keeps `git` and `commit`
 * on the same invocation rather than pairing them across a compound command.
 */
const RE_GIT_COMMIT =
  /\bgit\b[^\n]{0,80}?\bcommit\b[^\n]*?(?:--message[= ]|-[A-Za-z]*m\s)\s*(['"])([\s\S]+?)\1/g;

// A heredoc body, so `-m "$(cat <<EOF …)"` yields the message and not the shell.
const RE_HEREDOC_BODY = /<<-?\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\s*\1\b/;

/* First line of a commit message, unwrapping a heredoc if there is one. */
const commitMessage = (raw) => {
  const heredoc = RE_HEREDOC_BODY.exec(raw);
  return (heredoc ? heredoc[2] : raw).split("\n")[0].trim();
};
const RE_GIT_BRANCH = /git\s+(?:checkout|switch)\s+(?:-b|-c)\s+([\w./\-]+)/g;
const RE_GH_PR_CREATE = /gh\s+pr\s+create\b/;
const RE_GH_PR_MERGE = /gh\s+pr\s+merge\b(?:\s+(\d+))?/g;
const RE_GIT_PUSH = /git\s+push\b/;

const FILE_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);

/*
 * Secret shapes stripped before the digest is emitted. This is a safety net,
 * not a guarantee: transcripts are free text, so a novel secret shape can
 * still get through. The judgement rules in SKILL.md remain the real defence.
 */
const RE_PEM_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const RE_KNOWN_TOKEN = new RegExp(
  [
    "sk-[A-Za-z0-9_-]{16,}",
    "gh[pousr]_[A-Za-z0-9]{20,}",
    "github_pat_[A-Za-z0-9_]{20,}",
    "sb_pat_[A-Za-z0-9_-]{20,}",
    "xox[abprs]-[A-Za-z0-9-]{10,}",
    "AKIA[0-9A-Z]{16}",
    "AIza[0-9A-Za-z_-]{30,}",
    "eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{4,}",
  ].join("|"),
  "g"
);
/*
 * The label may be any part of a compound identifier: SERVICE_MANAGEMENT_TOKEN
 * (prefix), AWS_SECRET_ACCESS_KEY (middle), --secret-key (dash-led flag). A
 * plain \b cannot see any of these, because `_` is a word character. The
 * leading class allows `-` so command-line flags match, and the value charset
 * is deliberately unchanged so template refs like ${{ secrets.X }} still miss.
 */
const SECRET_WORDS =
  "bearer|token|api[_-]?key|apikey|secret|password|passwd|pwd|credential|passphrase";
const RE_LABELLED_SECRET = new RegExp(
  "(^|[^A-Za-z0-9_])" +
    `((?:[A-Za-z0-9]+[_-])*(?:${SECRET_WORDS})(?:[_-][A-Za-z0-9]+)*)` +
    "([\"']?\\s*[=:]\\s*[\"']?|\\s+)" +
    "([A-Za-z0-9._~+/=-]{12,})",
  "gi"
);
const RE_URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
/*
 * The lookbehind keeps version strings out: 10.x is both a private range and a
 * plausible semver, and "[internal ip] of the lib" is its own kind of wrong.
 */
const RE_PRIVATE_IP =
  /(?<![vV@^~]|version\s|>=)\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g;

/*
 * writeSync, not console.error: process.exit() does not drain an async stderr
 * pipe, so a buffered diagnostic can be lost on the way out. die() is the one
 * place that must abort mid-function, so it keeps the hard exit.
 */
const die = (msg) => {
  writeSync(2, `${msg}\n`);
  process.exit(1);
};

// ---------------------------------------------------------------- time window

const pad = (n) => String(n).padStart(2, "0");

/* Local-time ISO string with offset, to the second — matches Python's isoformat. */
function isoLocal(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const offsetHours = pad(Math.floor(Math.abs(off) / 60));
  const offsetMinutes = pad(Math.abs(off) % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${offsetHours}:${offsetMinutes}`
  );
}

const midnight = (d) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
/* Monday=0, to match Python's weekday(). */
const weekday = (d) => (d.getDay() + 6) % 7;

/*
 * Parse a window boundary. A date-only value must become local midnight —
 * bare `new Date("2026-08-13")` is read as UTC, which shifts the boundary by
 * the local offset. Both --since and --until go through here.
 */
function parseBound(spec) {
  const trimmedSpec = spec.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmedSpec);
  if (dateOnly) return new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]);
  return parseTs(trimmedSpec);
}

/* Return [startDate, humanLabel, kind] for a --since spec. */
function parseSince(spec, now) {
  const normalizedSpec = spec.trim().toLowerCase();

  if (normalizedSpec === "today") return [midnight(now), "today", null];
  if (normalizedSpec === "yesterday")
    return [addDays(midnight(now), -1), "yesterday and today so far", null];
  if (normalizedSpec === "week" || normalizedSpec === "thisweek" || normalizedSpec === "this-week")
    return [addDays(midnight(now), -weekday(now)), "this week", null];
  if (normalizedSpec === "standup" || normalizedSpec === "lastworkday" || normalizedSpec === "last-workday") {
    // Monday reaches back over the weekend; otherwise the previous day.
    const days = weekday(now) === 0 ? 3 : 1;
    // The window always runs to now, so say so — "since" alone reads as "on".
    return [
      addDays(midnight(now), -days),
      "the last working day and today so far",
      "standup",
    ];
  }

  const relativeMatch = /^(\d+(?:\.\d+)?)\s*([mhdw])$/.exec(normalizedSpec);
  if (relativeMatch) {
    const amount = parseFloat(relativeMatch[1]);
    const unitMs = { m: 60000, h: 3600000, d: 86400000, w: 604800000 }[relativeMatch[2]];
    const names = { m: "minute", h: "hour", d: "day", w: "week" };
    const noun = names[relativeMatch[2]] + (amount === 1 ? "" : "s");
    return [new Date(now.getTime() - amount * unitMs), `the last ${amount} ${noun}`, null];
  }

  const bound = parseBound(normalizedSpec);
  if (bound) return [bound, `since ${isoLocal(bound).slice(0, 10)}`, null];

  die(
    `standup: cannot parse --since '${spec}'. ` +
      "Use 24h, 3d, 1w, 90m, today, yesterday, week, standup, or an ISO date."
  );
}

function parseTs(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsedDate = typeof value === "number" ? new Date(value) : new Date(String(value));
  return isNaN(parsedDate.getTime()) ? null : parsedDate;
}

// ------------------------------------------------------------------ scanning

function cleanPrompt(text) {
  text = text.trim();
  if (!text) return null;
  if (NOISE_TAGS.some((t) => text.startsWith(`<${t}>`))) return null;
  if (RE_IMAGE_SOURCE.test(text)) return null;
  text = text.replace(RE_COMMAND_MSG, "");
  text = text.replace(RE_TAG, "").trim();
  if (NOISE_PREFIXES.some((p) => text.startsWith(p))) return null;
  text = text.replace(RE_IMAGE_REF, "[image]").trim();
  if (!text || text === "[image]") return null;
  return text;
}

/*
 * Blank out hex colors so they are not mistaken for issue numbers.
 *
 * A short all-digit token like #123 stays: it is far more likely an issue
 * reference than a three-digit color.
 */
function scrubColors(text) {
  return text.replace(RE_HEX_COLOR, (match) => {
    const body = match.slice(1);
    const looksLikeColor =
      [3, 4, 6, 8].includes(body.length) &&
      (/[a-fA-F]/.test(body) || body.length >= 6);
    return looksLikeColor ? " " : match;
  });
}

function truncate(text, limit) {
  text = text.split(/\s+/).filter(Boolean).join(" ");
  return text.length <= limit ? text : text.slice(0, limit - 1).trimEnd() + "…";
}

/*
 * Redaction has to happen before truncation: a secret clipped mid-pattern no
 * longer matches its own regex, and the surviving fragment is still a secret.
 * main() sets this before any scanning; the deepRedact pass at the end is a
 * second net for strings that never pass through truncate().
 */
let redactEnabled = true;

const maybeRedact = (text) => (redactEnabled ? redactText(text) : text);

function redactText(text) {
  if (!text) return text;
  let out = text.replace(RE_PEM_KEY, "[redacted private key]");
  out = out.replace(RE_KNOWN_TOKEN, "[redacted token]");
  out = out.replace(RE_URL_CREDENTIALS, "$1[redacted]@");
  out = out.replace(RE_LABELLED_SECRET, (_m, lead, label, sep) => `${lead}${label}${sep}[redacted]`);
  out = out.replace(RE_PRIVATE_IP, "[internal ip]");
  if (HOME) out = out.split(HOME).join("~");
  return out;
}

/* Redact every string in the finished report, at any depth. */
function deepRedact(value) {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(deepRedact);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepRedact(v)]));
  return value;
}

/*
 * Collapse the two spellings of one path to a single key: tool inputs carry
 * absolute paths, file-history-delta carries paths relative to the session
 * cwd. Anything inside the project ends up repo-relative, which is also what
 * the report should be quoting.
 */
function normalizeFiles(rawFiles, cwd) {
  const out = new Set();
  for (const file of rawFiles) {
    let path = isAbsolute(file) || !cwd ? file : join(cwd, file);
    if (cwd) {
      const rel = relative(cwd, path);
      if (rel && !rel.startsWith("..") && !isAbsolute(rel)) path = rel;
    }
    out.add(path);
  }
  return sortedArr(out);
}

function collectRefs(text, refs) {
  for (const [, repo, num] of text.matchAll(RE_PR_URL))
    if (!isPlaceholderRepo(repo)) refs.prs.add(`${repo}#${num}`);
  for (const [, repo, num] of text.matchAll(RE_ISSUE_URL))
    if (!isPlaceholderRepo(repo)) refs.issues.add(`${repo}#${num}`);
  for (const [, repo, num] of text.matchAll(RE_REPO_HASH))
    if (!isPlaceholderRepo(repo)) refs.mentions.add(`${repo}#${num}`);

  const scrubbed = scrubColors(text).replace(RE_IMAGE_REF, " ");
  for (const match of scrubbed.matchAll(RE_BARE_HASH)) {
    const from = Math.max(0, match.index - ISSUE_CONTEXT_RADIUS);
    const around = scrubbed.slice(from, match.index + match[0].length + ISSUE_CONTEXT_RADIUS);
    if (RE_ISSUE_CONTEXT.test(around)) refs.mentions.add(`#${match[1]}`);
  }
}

const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
/* Highest count first, insertion order preserved for ties (as Counter does). */
const byCountDesc = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]);
const sortedArr = (set) => [...set].sort();

/*
 * Read one transcript into records, skipping blank and unparseable lines.
 * Returns null when the file cannot be read at all — a transcript that
 * vanished between listing and reading is not worth reporting as an error.
 */
function readTranscriptRecords(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const records = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      continue;
    }
  }
  return records;
}

/*
 * Sum the gaps between consecutive events, ignoring any longer than
 * IDLE_GAP_MS — those are time away from the keyboard, not time worked.
 * Expects eventTimes already sorted ascending.
 */
function sumActiveMs(eventTimes) {
  let activeMs = 0;
  for (let index = 1; index < eventTimes.length; index++) {
    const gap = eventTimes[index] - eventTimes[index - 1];
    if (gap <= IDLE_GAP_MS) activeMs += gap;
  }
  return activeMs;
}

/*
 * Keep the head and tail of a long conversation: how it started, how it ended.
 * The marker in the middle names how many turns are missing, so a trimmed list
 * never reads as a complete one.
 */
function trimPromptList(prompts) {
  if (prompts.length <= MAX_PROMPTS_PER_SESSION) return prompts;
  const keep = MAX_PROMPTS_PER_SESSION - 4;
  const dropped = prompts.length - MAX_PROMPTS_PER_SESSION;
  return [...prompts.slice(0, keep), `… (${dropped} more turns) …`, ...prompts.slice(-4)];
}

/* Drop the reference kinds that found nothing, and sort what remains. */
function compactRefs(refs) {
  const out = {};
  for (const [kind, values] of Object.entries(refs))
    if (values.size) out[kind] = sortedArr(values);
  return out;
}

/*
 * Absorb one user record: its prompts, its slash commands, and any references
 * they mention. Returns without recording anything when the record was
 * generated by the harness rather than typed.
 */
function absorbUserContent(rec, content, timestamp, { harnessParents, slash, prompts, refs }) {
  const blocks = typeof content === "string" ? [content] : content || [];

  /*
   * Two harness shapes inject a user record nobody typed: a slash
   * command's expansion (child of the <command-name> envelope) and a
   * model-invoked skill's prompt (child of the Skill tool_result). Both
   * land within ~3ms of their parent, while the fastest genuine follow-up
   * measured was 6.6s — so proximity to a known harness parent is the
   * discriminator. The lineage link alone is not enough: every record's
   * parent is its predecessor, so it would swallow real prompts. Matching
   * on text would need a denylist entry per installed skill.
   */
  const parentAt = harnessParents.get(rec.parentUuid);
  if (parentAt !== undefined && Math.abs(timestamp.getTime() - parentAt) <= HARNESS_ECHO_MS)
    return;

  if (rec.uuid && blocks.some((b) => b && b.type === "tool_result"))
    harnessParents.set(rec.uuid, timestamp.getTime());
  for (const block of blocks) {
    let text;
    if (typeof block === "string") text = block;
    else if (block && block.type === "text") text = block.text || "";
    else continue; // tool_result / image
    const cmd = RE_COMMAND_NAME.exec(text);
    if (cmd) {
      const name = cmd[1].trim();
      if (!slash.includes(name)) slash.push(name);
      if (rec.uuid) harnessParents.set(rec.uuid, timestamp.getTime());

      // The args are what the user typed; the command name alone rarely
      // says why they ran it. Attributed to the command, since an argument
      // like "better-comments-zed-extension" is opaque on its own.
      const argsMatch = RE_COMMAND_ARGS.exec(text);
      const commandArgs = argsMatch ? cleanPrompt(argsMatch[1]) : null;
      if (commandArgs) {
        collectRefs(commandArgs, refs);
        prompts.push(truncate(maybeRedact(`${name} ${commandArgs}`), PROMPT_TRUNCATE));
      }

      continue;
    }
    const cleaned = cleanPrompt(text);
    if (cleaned) {
      collectRefs(cleaned, refs);
      prompts.push(truncate(maybeRedact(cleaned), PROMPT_TRUNCATE));
    }
  }
}

/*
 * Absorb one assistant record: tool usage, files touched, git operations and
 * references. Returns the last thing the assistant actually said, or null if
 * it said nothing — the caller keeps that as the session's closing summary.
 */
function absorbAssistantContent(content, { tools, files, gitOps, branches, refs }) {
  let lastAssistant = null;
  for (const block of content || []) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text") {
      const text = block.text || "";
      if (text.trim()) {
        collectRefs(text, refs);
        lastAssistant = text;
      }
    } else if (block.type === "tool_use") {
      const name = block.name || "?";
      bump(tools, name);
      const inp = block.input;
      if (!inp || typeof inp !== "object" || Array.isArray(inp)) continue;
      if (FILE_TOOLS.has(name) && inp.file_path) {
        files.add(inp.file_path);
      } else if (name === "Bash") {
        const cmdline = String(inp.command ?? "");
        collectRefs(cmdline, refs);
        for (const [, , raw] of cmdline.matchAll(RE_GIT_COMMIT)) {
          const message = commitMessage(raw);
          if (message) gitOps.push(`commit: ${truncate(maybeRedact(message), 120)}`);
        }
        for (const [, br] of cmdline.matchAll(RE_GIT_BRANCH)) {
          branches.add(br);
          gitOps.push(`created branch ${br}`);
        }
        if (RE_GH_PR_CREATE.test(cmdline)) gitOps.push("opened a pull request (gh pr create)");
        for (const [, num] of cmdline.matchAll(RE_GH_PR_MERGE))
          gitOps.push(`merged pull request ${num ? "#" + num : ""}`.trim());
        if (RE_GIT_PUSH.test(cmdline)) gitOps.push("pushed to remote");
      }
    }
  }
  return lastAssistant;
}
/* Parse one transcript, returning a session summary if it has in-window activity. */
function scanSession(path, since, until) {
  let title = null;
  let cwd = null;
  const projectEvents = new Map();
  const branches = new Set();
  let prompts = [];
  const slash = [];
  const tools = new Map();
  const files = new Set();
  const gitOps = [];
  const refs = { prs: new Set(), issues: new Set(), mentions: new Set() };
  let lastAssistant = null;
  const eventTimes = [];
  let sidechainEvents = 0;
  // uuid -> event time (ms) for records that can father a harness-generated
  // child: slash-command envelopes, and tool_result carriers (a model-invoked
  // skill's prompt arrives as a child of the Skill tool's result).
  const harnessParents = new Map();

  const records = readTranscriptRecords(path);
  if (records === null) return null;

  for (const rec of records) {
    const rtype = rec.type;

    // Session-level metadata carries no timestamp; always absorb it.
    if (rtype === "ai-title") {
      title = rec.aiTitle || title;
      continue;
    }

    const timestamp = parseTs(rec.timestamp);
    if (timestamp === null) continue;
    if (!(timestamp >= since && timestamp <= until)) continue;

    eventTimes.push(timestamp);

    if (rec.cwd) {
      cwd = rec.cwd;
      bump(projectEvents, rec.cwd);
    }
    const branch = rec.gitBranch;
    if (branch && branch !== "HEAD") branches.add(branch);

    if (rec.isSidechain) {
      sidechainEvents++;
      continue; // subagent chatter, not the user's own thread
    }

    if (rtype === "file-history-delta" && rec.trackingPath) {
      files.add(rec.trackingPath);
      continue;
    }

    const msg = rec.message;
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) continue;
    const role = msg.role;
    const content = msg.content;

    if (role === "user") {
      absorbUserContent(rec, content, timestamp, { harnessParents, slash, prompts, refs });
    } else if (role === "assistant") {
      const spoken = absorbAssistantContent(content, { tools, files, gitOps, branches, refs });
      if (spoken !== null) lastAssistant = spoken;
    }
  }

  if (!eventTimes.length) return null;

  eventTimes.sort((a, b) => a - b);
  const activeMs = sumActiveMs(eventTimes);

  if (projectEvents.size) cwd = byCountDesc(projectEvents)[0][0];

  // Count before trimming: prompt_count is how much was said, not how much is shown.
  const promptCount = prompts.length;

  prompts = trimPromptList(prompts);

  const outRefs = compactRefs(refs);

  return {
    id: basename(path, ".jsonl"),
    title,
    project: cwd,
    branches: sortedArr(branches),
    started: isoLocal(eventTimes[0]),
    ended: isoLocal(eventTimes[eventTimes.length - 1]),
    active_minutes: Math.round(activeMs / 60000),
    prompt_count: promptCount,
    prompts,
    slash_commands: slash,
    tools: Object.fromEntries(byCountDesc(tools)),
    tool_calls: [...tools.values()].reduce((a, b) => a + b, 0),
    subagent_events: sidechainEvents,
    files_touched: normalizeFiles(files, cwd),
    git_ops: [...new Set(gitOps)],
    refs: outRefs,
    closing_summary: lastAssistant
      ? truncate(maybeRedact(lastAssistant), ASSISTANT_TRUNCATE)
      : null,
    transcript: path,
  };
}

/*
 * A session that recorded nothing but a slash command: no prompt, no file, no
 * git operation, no title. Counted but never rendered — it is not standup
 * material, and leaving it in makes totals.sessions overstate the day. All
 * four signals must be absent, so a one-line question with a real answer stays.
 */
const isTrivial = (session) =>
  !session.prompt_count &&
  !session.files_touched.length &&
  !session.git_ops.length &&
  !session.title;

/* history.jsonl is a cheap index of every prompt actually typed. */
function scanHistory(since, until) {
  const out = [];
  if (!existsSync(HISTORY_FILE)) return out;
  let raw;
  try {
    raw = readFileSync(HISTORY_FILE, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const timestamp = parseTs(rec.timestamp);
    if (timestamp === null) continue;
    if (timestamp >= since && timestamp <= until) {
      out.push({
        at: isoLocal(timestamp),
        project: rec.project ?? null,
        session: rec.sessionId ?? null,
        text: truncate(maybeRedact(String(rec.display ?? "")), PROMPT_TRUNCATE),
      });
    }
  }
  return out;
}

// ----------------------------------------------------------------- git commits

const git = (args) =>
  spawnSync("git", args, { encoding: "utf8", timeout: 20000 });

/* Real commits authored by the user, as corroboration for the session story. */
function gitCommits(repos, since, until, warnings) {
  const commits = [];
  const seen = new Set();
  for (const repo of repos) {
    try {
      if (!repo || !statSync(repo).isDirectory()) continue;
    } catch {
      continue;
    }
    const top = git(["-C", repo, "rev-parse", "--show-toplevel"]);
    if (top.status !== 0 || !top.stdout) continue;
    const root = top.stdout.trim();
    if (seen.has(root)) continue;
    seen.add(root);

    const email = (git(["-C", root, "config", "user.email"]).stdout || "").trim();

    const cmd = [
      "-C", root, "log",
      `--since=${isoLocal(since)}`,
      `--until=${isoLocal(until)}`,
      "--pretty=format:%h\x1f%an\x1f%aI\x1f%s\x1f%D",
    ];
    if (email) cmd.push(`--author=${email}`);
    // Without an author filter the log is everyone's work, not the user's.
    else
      warnings.push(
        `git user.email is unset in ${root} — its commits are unfiltered by author ` +
          "and may include other people's work."
      );
    const res = git(cmd);
    if (res.status !== 0 || !res.stdout) continue;
    for (const line of res.stdout.split("\n")) {
      if (!line) continue;
      const parts = line.split("\x1f");
      if (parts.length < 4) continue;
      commits.push({
        repo: root,
        sha: parts[0],
        author: parts[1],
        at: parts[2],
        subject: parts[3],
        refs: parts[4] ?? "",
      });
    }
  }
  commits.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return commits;
}

// -------------------------------------------------------------------- output

function renderText(report) {
  const reportWindow = report.window;
  const lines = [`# Standup — ${reportWindow.label} (${reportWindow.since} → ${reportWindow.until})`, ""];
  const totals = report.totals;
  lines.push(
    `${totals.sessions} session(s), ${totals.prompts} prompts, ${totals.tool_calls} tool calls, ` +
      `${totals.files_touched} files touched, ~${totals.active_minutes} min active` +
      (totals.trivial_sessions ? ` (${totals.trivial_sessions} empty session(s) skipped)` : "")
  );
  if (report.warnings?.length) {
    lines.push("");
    for (const warning of report.warnings) lines.push(`! ${warning}`);
  }
  if (!report.sessions.length) {
    lines.push("\nNo Claude Code activity in this window.");
    return lines.join("\n");
  }

  for (const s of report.sessions) {
    lines.push("");
    lines.push(`## ${s.title || "(untitled session)"}  [${s.id.slice(0, 8)}]`);
    const meta = [`project: ${s.project}`];
    if (s.branches.length) meta.push(`branch: ${s.branches.join(", ")}`);
    const { started, ended } = s;
    // Show dates too when a session straddles midnight, so the range reads forward.
    const span =
      started.slice(0, 10) === ended.slice(0, 10)
        ? `${started.slice(0, 10)} ${started.slice(11, 16)}–${ended.slice(11, 16)}`
        : `${started.slice(0, 16).replace("T", " ")} → ${ended.slice(0, 16).replace("T", " ")}`;
    meta.push(`${span} (~${s.active_minutes}m)`);
    lines.push("  " + meta.join(" | "));
    if (s.prompts.length) {
      lines.push("  asked:");
      lines.push(...s.prompts.map((p) => `    - ${p}`));
    }
    if (s.slash_commands.length) lines.push(`  commands: ${s.slash_commands.join(", ")}`);
    if (s.files_touched.length) {
      lines.push("  files:");
      lines.push(...s.files_touched.map((f) => `    - ${f}`));
    }
    if (s.git_ops.length) lines.push(`  git: ${s.git_ops.join("; ")}`);
    if (Object.keys(s.refs).length) {
      // Spaced separators, so this line reads the same as the JSON format's.
      const body = Object.entries(s.refs)
        .map(([k, v]) => `${JSON.stringify(k)}: [${v.map((x) => JSON.stringify(x)).join(", ")}]`)
        .join(", ");
      lines.push(`  refs: {${body}}`);
    }
    if (s.closing_summary) lines.push(`  ended with: ${s.closing_summary}`);
  }

  if (report.git_commits.length) {
    lines.push("\n## Commits");
    for (const c of report.git_commits)
      lines.push(`  ${c.at.slice(0, 16)} ${c.sha} ${c.subject}  (${c.repo})`);
  }
  return lines.join("\n");
}

/*
 * Keep the report inside --max-bytes by shedding detail in a fixed order, and
 * say in `warnings` what each step dropped. The alternative — letting the model
 * pick a narrower window — is a judgement it has to make before it can know the
 * size. A step that fires mutates `report` in place; the caller re-serialises
 * after each one and stops as soon as the payload fits.
 */
function shedToFit(report, render, maxBytes) {
  if (!maxBytes) return render(report);

  const trimPrompts = (limit) => (session) => {
    if (session.prompts.length <= limit) return;
    const head = Math.max(1, limit - 2);
    session.prompts = [
      ...session.prompts.slice(0, head),
      `… (${session.prompt_count - limit} more turns) …`,
      ...session.prompts.slice(-(limit - head - 1)),
    ];
  };

  const steps = [
    // The cheap two first: SKILL.md forbids quoting a transcript path anyway,
    // and the per-tool histogram is not standup material. Neither costs signal,
    // so they go before anything that does.
    [
      "Dropped transcript paths",
      (s) => {
        delete s.transcript;
      },
    ],
    [
      "Dropped per-tool call counts (tool_calls totals kept)",
      (s) => {
        delete s.tools;
      },
    ],
    ["Trimmed prompt lists to 8 entries per session", trimPrompts(8)],
    [
      "Shortened closing summaries to 200 characters",
      (s) => {
        if (s.closing_summary) s.closing_summary = truncate(s.closing_summary, 200);
      },
    ],
    ["Trimmed prompt lists to 4 entries per session", trimPrompts(4)],
    [
      "Dropped closing summaries",
      (s) => {
        s.closing_summary = null;
      },
    ],
    [
      "Capped file lists at 10 entries per session",
      (s) => {
        if (s.files_touched.length > 10)
          s.files_touched = [
            ...s.files_touched.slice(0, 10),
            `… and ${s.files_touched.length - 10} more files`,
          ];
      },
    ],
  ];

  let out = render(report);
  for (const [note, apply] of steps) {
    if (Buffer.byteLength(out, "utf8") <= maxBytes) return out;
    report.sessions.forEach(apply);
    report.warnings.push(`${note} to fit --max-bytes ${maxBytes}.`);
    out = render(report);
  }

  if (Buffer.byteLength(out, "utf8") > maxBytes) {
    // Never truncate to fit: an over-budget report that says so beats a short
    // one that does not. This is the bug the whole change exists to remove.
    report.warnings.push(
      `Report is ${Buffer.byteLength(out, "utf8")} bytes, over --max-bytes ${maxBytes}, ` +
        "and was emitted in full — narrow the window with --since or --project."
    );
    out = render(report);
  }
  return out;
}

function parseArgs(argv) {
  const args = {
    since: "24h",
    until: null,
    project: null,
    format: "json",
    maxBytes: DEFAULT_MAX_BYTES,
    noGit: false,
    history: false,
    redact: true,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    const valueOf = (name) => {
      const equalsIndex = argument.indexOf("=");
      if (argument.startsWith(`${name}=`)) return argument.slice(equalsIndex + 1);
      const next = argv[++i];
      if (next === undefined) die(`standup: ${name} needs a value`);
      return next;
    };
    if (argument === "--since" || argument.startsWith("--since=")) args.since = valueOf("--since");
    else if (argument === "--until" || argument.startsWith("--until=")) args.until = valueOf("--until");
    else if (argument === "--project" || argument.startsWith("--project=")) args.project = valueOf("--project");
    else if (argument === "--format" || argument.startsWith("--format=")) args.format = valueOf("--format");
    else if (argument === "--max-bytes" || argument.startsWith("--max-bytes=")) {
      const raw = valueOf("--max-bytes");
      if (!/^\d+$/.test(raw.trim()))
        die(`standup: --max-bytes must be a non-negative integer, got '${raw}'`);
      args.maxBytes = parseInt(raw, 10);
    }
    else if (argument === "--no-git") args.noGit = true;
    else if (argument === "--history") args.history = true;
    else if (argument === "--no-redact") args.redact = false;
    else if (argument === "-h" || argument === "--help") {
      console.log(
        "Digest recent Claude Code sessions.\n\n" +
          "  --since VALUE    24h, 3d, 1w, today, yesterday, week, standup, or ISO date (default 24h)\n" +
          "  --until VALUE    ISO datetime or date upper bound (default: now)\n" +
          "  --project SUB    Only sessions whose cwd contains this substring\n" +
          "  --format FORMAT  json (default) or text\n" +
          "  --max-bytes N    Shed detail to keep output under N bytes (default 60000, 0 disables)\n" +
          "  --no-git         Skip git log corroboration\n" +
          "  --history        Include the raw prompt index\n" +
          "  --no-redact      Keep secret-shaped strings and $HOME paths verbatim\n\n" +
          "Windows run from --since up to --until (now, unless set), so the default\n" +
          "standup window includes today's work as well as the previous day's.\n\n" +
          "When --max-bytes forces a reduction, what was shed is named in `warnings`;\n" +
          "the report is never shortened silently."
      );
      // Not process.exit(0): that can strand the buffered help text on a pipe.
      args.help = true;
      return args;
    } else die(`standup: unknown argument '${argument}'`);
  }
  if (!["json", "text"].includes(args.format))
    die(`standup: --format must be json or text, got '${args.format}'`);
  return args;
}

/*
 * Resolve the reporting window from --since and --until, dying with a
 * diagnostic when the pair describes no time at all.
 */
function resolveWindow(args, now) {
  const [since, label, kind] = parseSince(args.since, now);

  let until = now;
  if (args.until) {
    const parsed = parseBound(args.until);
    if (parsed === null) die(`standup: cannot parse --until '${args.until}'`);
    until = parsed;
  }

  // Name the bound the user actually got wrong, rather than the defaulted one.
  if (until <= since) {
    if (args.until)
      die(
        `standup: --until (${isoLocal(until)}) is not after --since (${isoLocal(since)}); ` +
          "the window is empty."
      );
    die(
      `standup: --since (${isoLocal(since)}) is in the future, so the window is empty. ` +
        "Pass a past date, or add --until to look at a historical range."
    );
  }

  return { since, until, label, kind };
}

/*
 * Every .jsonl transcript under the projects directory, sorted. Returns null
 * when that directory is missing altogether — a setup problem rather than an
 * empty result. A single project directory that cannot be read is skipped.
 */
function findTranscriptPaths() {
  let projectDirs;
  try {
    projectDirs = readdirSync(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return null;
  }

  const paths = [];
  for (const entry of projectDirs) {
    if (!entry.isDirectory()) continue;
    const dir = join(PROJECTS_DIR, entry.name);
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) if (name.endsWith(".jsonl")) paths.push(join(dir, name));
  }
  paths.sort();
  return paths;
}

/* Union the per-session references into one set of report-level references. */
function mergeSessionRefs(sessions) {
  const allRefs = { prs: new Set(), issues: new Set(), mentions: new Set() };
  for (const session of sessions)
    for (const [kind, values] of Object.entries(session.refs))
      for (const item of values) allRefs[kind].add(item);
  return compactRefs(allRefs);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return 0;

  redactEnabled = args.redact;

  const now = new Date();
  const warnings = [];
  let { since, until, label, kind } = resolveWindow(args, now);

  const paths = findTranscriptPaths();
  if (paths === null) {
    console.error(`standup: no session directory at ${PROJECTS_DIR}`);
    return 1;
  }

  const collectSessions = (from, to) => {
    const out = [];
    let trivial = 0;
    for (const path of paths) {
      try {
        // Transcripts are append-only: an old mtime means no in-window events.
        if (statSync(path).mtime < from) continue;
      } catch {
        continue;
      }
      const summary = scanSession(path, from, to);
      if (!summary) continue;
      if (args.project && !(summary.project || "").includes(args.project)) continue;
      if (isTrivial(summary)) {
        trivial++;
        continue;
      }
      out.push(summary);
    }
    out.sort((a, b) => (a.started < b.started ? -1 : a.started > b.started ? 1 : 0));
    return { sessions: out, trivial };
  };

  let { sessions, trivial: trivialSessions } = collectSessions(since, until);

  /*
   * "Previous working day" is a calendar guess, and calendars lie: holidays,
   * days off, and a Tuesday after a long weekend all yield a window whose
   * only activity is today's. Widen it until a prior day has something in it.
   */
  if (kind === "standup") {
    const todayStart = midnight(now);
    const hasPriorDay = (list) => list.some((s) => new Date(s.started) < todayStart);
    for (let back = 1; !hasPriorDay(sessions) && back <= 6; back++) {
      const probe = addDays(since, -back);
      const widened = collectSessions(probe, until);
      // A day whose only activity was trivial does not count as an active day.
      if (!hasPriorDay(widened.sessions)) continue;
      const day = isoLocal(probe).slice(0, 10);
      warnings.push(
        `No activity on the previous working day; widened the window back to ${day}.`
      );
      label = `your last active day (${day}) and today so far`;
      since = probe;
      sessions = widened.sessions;
      trivialSessions = widened.trivial;
    }

    // Say so rather than returning a bare empty report.
    if (!hasPriorDay(sessions))
      warnings.push(
        "No activity found on any of the six days before today; the window covers today only."
      );
  }

  const projects = [...new Set(sessions.map((s) => s.project).filter(Boolean))].sort();
  const commits = args.noGit ? [] : gitCommits(projects, since, until, warnings);

  const references = mergeSessionRefs(sessions);

  const report = {
    generated_at: isoLocal(now),
    window: { since: isoLocal(since), until: isoLocal(until), label },
    redacted: args.redact,
    warnings,
    totals: {
      sessions: sessions.length,
      trivial_sessions: trivialSessions,
      prompts: sessions.reduce((a, s) => a + s.prompt_count, 0),
      tool_calls: sessions.reduce((a, s) => a + s.tool_calls, 0),
      files_touched: new Set(sessions.flatMap((s) => s.files_touched)).size,
      active_minutes: sessions.reduce((a, s) => a + s.active_minutes, 0),
    },
    projects,
    references,
    git_commits: commits,
    sessions,
  };
  if (args.history) report.prompt_index = scanHistory(since, until);

  const out = args.redact ? deepRedact(report) : report;
  const render = (r) => (args.format === "text" ? renderText(r) : JSON.stringify(r, null, 2));
  console.log(shedToFit(out, render, args.maxBytes));
  return 0;
}

/*
 * process.exitCode, not process.exit(): writes to a pipe are asynchronous, and
 * process.exit() kills the process without draining them — silently cutting
 * output at one pipe buffer (65,536 bytes on macOS). The skill is always run
 * through a pipe, so letting Node exit on its own is the only correct form.
 */
process.exitCode = main();
