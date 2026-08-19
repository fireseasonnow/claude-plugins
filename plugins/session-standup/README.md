# session-standup

Turns local Claude Code session history into a standup report — what you
finished and where it landed.

Most standup tools read your commits. This one reads what you were actually
doing — so it still has something to say on a day you shipped nothing.

```markdown
**Yesterday**
- Fixed the token-refresh race in the gateway — auth-service, PR #214
- Traced the flaky checkout test to a shared fixture; fix in review
- Spiked two approaches for the export queue, settled on the simpler one

**Today**
- Land the fixture fix, start on the export queue

**Blockers**
- None
```

*(Illustrative — assembled from invented sessions, not a real run.)*

## Where it runs

Everything happens on your machine, under your user account. The collector
reads every session transcript under your Claude Code config directory —
**all projects, not just the current one** — and runs read-only `git log` in
the repositories those sessions touched.

It makes **no network calls**. The digest it produces is then sent to the
model as ordinary tool output, like any other command's result, so the summary
does leave your machine even though the transcripts do not.

## Install

```
/plugin marketplace add fireseasonnow/claude-plugins
/plugin install session-standup@fireseason-plugins
```

The skill registers as `session-standup:standup`. You rarely need to name it —
asking for a standup, a daily recap, or "what did I work on yesterday" triggers
it directly.

## Requirements

- **Node 18+ or Bun** on `PATH`. Both produce identical output.
- **macOS or Linux.** Verified by running the suite on both. Windows is
  untested and assumes a POSIX `$HOME` layout.
- **`git` is optional.** Without it, pass `--no-git` for a complete report
  minus commit corroboration.

## Use

| Ask | Window |
|---|---|
| "give me my standup" | Since the last working day (reaches back over the weekend on Mondays) |
| "what did I do last week" | The last 7 days |
| "recap the past 3 days" | The last 3 days |
| "what have I done since August 1st" | From an ISO date |

Any argument is read as a time window. There are no other modes. Every window
runs up to *now*, so the default covers the previous working day **and today so
far**.

## What's in here

```
skills/standup/
├── SKILL.md            instructions: how to read the digest and write the report
├── standup.mjs         collector: transcripts + git log → JSON digest
└── standup.test.mjs    16 hermetic tests, no dependencies
```

The split matters — the collector reduces megabytes of transcripts to a few
kilobytes of digest, so your session history never enters the model's context.
Only the summary does.

`standup.mjs` is a dependency-free CLI you can run on its own:

```bash
node skills/standup/standup.mjs --since 1w --format text
```

| Flag | Effect |
|---|---|
| `--since <spec>` | `24h`, `90m`, `3d`, `1w`, `today`, `yesterday`, `week`, `standup`, or an ISO date |
| `--until <when>` | Upper bound; defaults to now |
| `--project <substr>` | Only sessions whose working directory matches |
| `--format json\|text` | `text` is a compact digest, roughly half the size |
| `--max-bytes <n>` | Output budget, default `60000`; `0` disables |
| `--no-git` | Skip the `git log` corroboration pass |
| `--history` | Append the raw typed-prompt index |
| `--no-redact` | Keep secret-shaped strings and `$HOME` paths verbatim |
| `-h`, `--help` | Usage summary; prints and exits without scanning |

On a wide window the budget sheds detail in a fixed order and names every
reduction in `warnings`. No session is ever dropped to fit — which means a
sufficiently wide window can exhaust the ladder and still exceed the budget.
When that happens the warning says so rather than presenting a thinned report
as complete.

To run the tests, from this directory:

```bash
cd skills/standup && node --test
```

## Redaction

Before printing, the collector strips the secret shapes it can recognise:
private IP addresses, PEM private keys, `sk-` / `ghp_` / `AKIA` / `sb_pat_` and
JWT-style tokens, credentials embedded in URLs, and any `LABEL=value` whose
label contains a secret word — `SERVICE_MANAGEMENT_TOKEN`,
`AWS_SECRET_ACCESS_KEY` and `--secret-key` all count. `$HOME` collapses to `~`.

**This is a safety net, not a guarantee.** Transcripts are free text. Customer
names, unannounced project names, internal hostnames, and a bare token with no
label and no recognisable prefix all still come through verbatim.

`SKILL.md` therefore also instructs Claude never to quote credentials, to
prefer repo-relative paths, and to describe sensitive subjects generically.
That is a second, prompt-level safeguard — and also not a guarantee.

A standup is written to be pasted into a shared channel. **Read it before you
paste it.**

## License

MIT — see [LICENSE](./LICENSE).
