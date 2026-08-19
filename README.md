# claude-plugins

Claude Code plugins by [fireseason](https://github.com/fireseasonnow).

**[session-standup](./plugins/session-standup)** turns local Claude Code
session history into a standup report — what you finished, which repos and
branches it landed in, and which PRs or issues it touched. For anyone who has
to say what they did yesterday and would rather not reconstruct it from
`git log`.

```
/plugin marketplace add fireseasonnow/claude-plugins
/plugin install session-standup@fireseason-plugins
```

Then just ask — "give me my standup", "what did I do yesterday", "recap the
past 3 days":

```markdown
**Yesterday**
- Fixed the token-refresh race in the gateway — auth-service, PR #214
- Traced the flaky checkout test to a shared fixture; fix in review
- Spiked two approaches for the export queue, settled on the simpler one

**Today**
- Land the fixture fix, start on the export queue *(inference)*

**Blockers**
- None
```

*(Illustrative — assembled from invented sessions, not a real run.)*

The skill registers as `session-standup:standup` if you'd rather name it
directly.

## What it does

Most standup tools read your commits. This one reads what you were actually
doing — so it still has something to say on a day you shipped nothing.

It reads the transcripts Claude Code already writes to
`~/.claude/projects/*.jsonl`, corroborates them against `git log`, and writes
the result as something you can paste into Slack.

The work splits in two: a dependency-free collector reduces megabytes of
transcripts to a few kilobytes of digest, and the skill instructions turn that
digest into prose. Your session history never enters the model's context —
only the summary does.

## How it compares

Anthropic's official marketplace has two neighbours worth knowing about:

- **`session-report`** — an explorable HTML report of usage: tokens, cache
  efficiency, subagents, expensive prompts. Analytics about *how you used
  Claude*.
- **`receipts`** — an impact report for justifying usage to a manager.

This one is narrower and aimed at a daily ritual: what you accomplished,
phrased for standup, short enough to paste. It also corroborates sessions
against real commits, so shipped work outranks activity.

## Requirements

**Node 18+ or Bun** on `PATH`; both produce identical output. **macOS or
Linux** — verified by running the test suite on both; Windows is untested and
assumes a POSIX `$HOME` layout. `git` is optional.

## Privacy

Everything runs locally and the collector makes **no network calls**. It does
read every session transcript for *all* your projects, not just the current
one, and the digest it produces is sent to the model as ordinary tool output —
so the summary leaves your machine even though the transcripts do not.

Before printing, the collector strips the secret shapes it can recognise:
private IPs, PEM keys, `sk-` / `ghp_` / `AKIA` / `sb_pat_` and JWT-style
tokens, credentials inside URLs, and any `LABEL=value` whose label contains a
secret word. `$HOME` collapses to `~`.

**That is a safety net, not a guarantee.** Transcripts are free text, so
customer names, unannounced project names, and an unlabelled token with no
recognisable prefix still come through. The skill separately instructs Claude
never to quote credentials and to describe sensitive subjects generically —
also not a guarantee.

A standup is written to be pasted into a shared channel. **Read it before you
paste it.**

Full detail, including every collector flag, is in the
[plugin README](./plugins/session-standup/README.md).

---

## Releasing

Claude Code keys a plugin's install path by its declared `version`, so a
version that never changes can strand users on a broken copy. **Bump
`version` in `plugins/session-standup/.claude-plugin/plugin.json` in the same
commit as any change to shipped content** — the skill, the collector,
`SKILL.md`, or the manifest itself. Documentation-only changes do not need it.

Before tagging a release, from `plugins/session-standup/skills/standup/`:

```bash
node --test                                              # 16 tests, no dependencies
docker run --rm -v "$PWD":/s:ro -w /s node:18-alpine node --test   # the stated floor
```

### Listing check

[`docs/listing.md`](./docs/listing.md) is the source of truth for every public
description, keyword, and topic. Before tagging, confirm nothing has drifted
away from it:

```bash
claude plugin validate . --strict                          # marketplace manifest
claude plugin validate ./plugins/session-standup --strict   # plugin manifest
gh repo view fireseasonnow/claude-plugins \
  --json description,homepageUrl,repositoryTopics           # compare to docs/listing.md
```

**A surface that disagrees with `docs/listing.md` blocks the release until it
is resolved** — fix the surface, or change the listing document first and then
every surface derived from it.

This check is deliberately manual. Replace it with a script the first time
either trigger fires: a third plugin joins the marketplace, or this check
catches real drift. Until then the machinery would cost more than the drift.

## License

MIT — see [LICENSE](./LICENSE).
