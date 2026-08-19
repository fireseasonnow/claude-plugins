---
name: standup
description: Generate a standup report from recent Claude Code sessions across all projects. Reads local session transcripts (~/.claude/projects/*.jsonl) plus git log to summarize what you worked on, which branches and files you touched, and which PRs/issues you referenced. Use when the user asks for a standup, a daily recap, "what did I work on", "what did I do yesterday", a status update, or a daily recap.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/standup/standup.mjs" *)
---

# Standup

Turn local Claude Code session history into a standup report. This is the
cross-session counterpart to `/recap` (which only covers the current session).

## Scope

This skill does one thing: a standup report. Invoked with no argument, it
covers the last working day. Any argument is read as a time window, never as a mode.

Free-form time phrases map onto `--since`: "yesterday" → `yesterday`,
"last week" → `1w`, "past 3 days" → `3d`, "since Monday" → an ISO date.
If the argument asks for something other than a time window, say the skill
only does standups and run the default window.

## Step 1 — gather

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/standup/standup.mjs" --since standup
```

Requires Node 18+ or Bun on `PATH`; `bun` works identically in place of `node`.
A `command not found` failure means the runtime is missing, not that the skill
is broken. `git` is optional — `--no-git` yields a complete report without
commit corroboration.

`--since` accepts `24h`, `90m`, `3d`, `1w`, `today`, `yesterday`, `week`,
`standup` (previous working day; reaches back over the weekend on Mondays), or
an ISO date. Other flags:

- `--until <ISO date or datetime>` — upper bound; defaults to *now*.
- `--format text` — compact digest instead of JSON, roughly half the size.
  JSON carries structure worth having; reach for text only if you want the
  digest to read as prose.
- `--max-bytes <n>` — output budget, default `60000`, `0` disables. The script
  keeps itself under this by shedding detail in a fixed order and naming each
  reduction in `warnings`. You do not need to guess a narrow window to control
  size — that is what this flag is for.
- `--project <substring>` — only sessions whose cwd matches.
- `--no-git` — skip the `git log` corroboration pass.
- `--history` — append the raw typed-prompt index from `history.jsonl`.
- `--no-redact` — keep secret-shaped strings and `$HOME` paths verbatim. Only
  pass this if the user explicitly asks for raw output.

**Every window runs up to `--until`, which defaults to now — so the default
standup window covers the previous working day *and today so far*.** That is
deliberate: a standup needs both. Describe it that way ("since yesterday,
including this morning"), never as "yesterday only", and put today's sessions
under **Today** rather than **Yesterday**. The script's own `window.label`
already says this — quote it rather than paraphrasing it into "on <day>".

For a strict single day, pass both bounds: `--since 2026-08-12 --until
2026-08-13`. Both accept date-only values and treat them as local midnight.

If `warnings` is non-empty, read it before writing. `standup` widens its window
when the previous working day is empty (holiday, day off, long weekend) and
says so there; a missing `git user.email` also surfaces there, and means the
commit list may include other people's work.

**A `--max-bytes` notice in `warnings` means the digest you are reading is
abridged** — prompt lists trimmed, closing summaries shortened or gone. Say so
in a closing line ("summarised from an abridged digest; ask for a narrower
window for more detail") rather than presenting a thinned report as complete.
No session is ever dropped to fit, so coverage is intact even when detail is
not; if a report genuinely could not be shrunk, the warning says that too.

Run it **once**. If it returns `"sessions": []`, say plainly that there was no
Claude Code activity in that window and offer a wider one — do not invent work.

## Step 2 — read the signal

`totals.sessions` counts substantive sessions only. Sessions that recorded
nothing but a slash command are excluded from the report and reported as
`totals.trivial_sessions` — there is nothing in them to narrate.

Each session carries, in rough order of usefulness:

- **`title`** — the auto-generated session title. Usually the single best
  one-line description of what that session was about.
- **`closing_summary`** — the last thing Claude said. Typically states what was
  actually accomplished, and is the most reliable evidence of an *outcome*.
- **`prompts`** — what the user actually asked, in order. Shows intent and how
  the goal shifted mid-session. Long sessions are trimmed to head + tail with a
  `… (N more turns) …` marker in the middle; `prompt_count` is always the true
  total, so don't infer session size from the array length.
  A slash command with arguments appears as one prompt attributed to its
  command (`/docs:search auth-token-rotation`) — usually the clearest statement of intent
  in the session. Skill prompt expansions never appear here, so anything that
  reads like instructions to Claude is something the user typed, not boilerplate.
- **`files_touched`**, **`git_ops`**, **`branches`** — concrete artifacts.
  Paths inside the project are repo-relative; anything outside it stays
  absolute (with `$HOME` collapsed to `~`). `git_ops` includes commits, branch
  creation, pushes, and `gh pr` calls. It is parsed from command lines, so a
  transcript that merely *discusses* a git command can produce a stray entry —
  prefer `git_commits` whenever the two disagree.
- **`git_commits`** (top level) — real commits from the repos involved,
  authored by the user's configured email. Strongest evidence of shipped work,
  and the source of truth for what was committed.
- **`refs`** — `prs` and `issues` are parsed from GitHub URLs, with
  documentation placeholders (`org/repo` and friends) filtered out; treat them
  as reliable. **`mentions` is a weak signal** — bare `#123` kept only when
  nearby wording marks it as a PR/issue/ticket. That gate removes line numbers
  and ids, but text *about* issues can still leak one, so only repeat a mention
  when the surrounding prompt makes it clearly a reference.

## Step 3 — write the standup

Default shape, tuned for pasting into Slack:

```markdown
**Yesterday**
- <outcome, not activity> — <repo/branch, PR or issue link if known>
- ...

**Today**
- <what the unfinished threads imply comes next>

**Blockers**
- <only if there is real evidence; otherwise "None">
```

Rules that make the difference between a useful report and noise:

- **Report outcomes, not keystrokes.** "Fixed the token-refresh race in the
  gateway" — not "ran 47 Bash commands and edited 3 files."
- **Merge sessions that share a subject.** Three sessions on the same bug are
  one standup line. Group by theme, never one bullet per session.
- **Drop trivia.** Wholly empty sessions are already excluded by the script, but
  a session that was only `/model`, `/theme`, or a one-off lookup still reaches
  you and is still not standup material.
- **Aim for 3–6 bullets under Yesterday.** If there are more, you have not
  merged aggressively enough.
- **Never invent.** If nothing evidences a blocker, write "None". Do not
  promote an abandoned session into a blocker without evidence — but an
  explicitly unresolved thread ("still failing", "come back to this") is one.
- **"Today" is inference — mark it as such** when it is a guess rather than
  something the user stated.
- **Cite lightly.** Repo and branch names help; absolute paths and session UUIDs
  do not. Include PR/issue numbers only from `refs.prs` / `refs.issues`.

## Privacy

Everything runs locally: the script makes no network calls, and only its output
enters the conversation. But that output is drawn from transcripts that may hold
API keys, customer names, internal hostnames, IPs, or private repo paths — and
the report is written to be pasted into a team channel.

The script redacts known secret shapes before printing (private IPs, PEM keys,
`sk-`/`ghp_`/`AKIA`/JWT-style tokens, credentials inside URLs, and any
`LABEL=value` whose label contains a secret word — `SERVICE_MANAGEMENT_TOKEN`,
`AWS_SECRET_ACCESS_KEY`, `--secret-key` all count) and collapses `$HOME` to `~`.
That is a safety net, not a guarantee: transcripts are free text, so customer
names, unannounced project names, and a bare token with no label and no
recognisable prefix still arrive verbatim. The rules below are the real defence.

So, when writing the report:

- Never quote a credential, token, key, connection string, or IP address, even
  if one appears verbatim in a prompt or a `closing_summary`.
- Prefer repo-relative paths over `$HOME` paths, and never print the
  `transcript` field — it is a local file path, useful only for debugging.
- If a session title or subject looks sensitive (a customer name, an unannounced
  project, anything security-related), describe it generically: "fixed an auth
  bug in the gateway", not the client's name.
- When in doubt, summarize at a higher altitude rather than omitting the work.

## Notes

- Transcripts are append-only, so the script skips files whose mtime predates
  the window — large histories stay fast.
- Subagent (sidechain) turns are excluded from `prompt_count` and `tool_calls`;
  they inflate activity without reflecting user intent. `active_minutes` does
  include them, since that time was still spent working.
- `gitBranch` is often `HEAD` outside a repo; the script omits those rather
  than reporting "HEAD" as a branch name.
- `standup.test.mjs` covers the contracts above; run `node --test` from this
  directory after changing the script.
