# Listing

Canonical public identity for every plugin in this marketplace. Everything a
stranger reads before installing — the plugin manifest, the marketplace entry,
the GitHub repository's About box, and any external directory listing — is
**derived from this file**.

## How to change these

1. Edit this file first.
2. Update every derived surface **in the same commit**:
   - `.claude-plugin/marketplace.json`
   - `plugins/<plugin>/.claude-plugin/plugin.json` (bump `version` — it is
     shipped content)
   - `README.md` and `plugins/<plugin>/README.md`
   - the published repository's settings, via the `gh repo edit` command
     recorded below
3. Re-run the release checks in [README.md](../README.md#releasing).

A surface that disagrees with this file is a bug in that surface, not in this
file.

---

## Repository

| Field | Canonical value |
|---|---|
| Homepage | `https://github.com/fireseasonnow/claude-plugins` |
| Marketplace name | `fireseason-plugins` |
| Owner | `fireseason` |
| License | MIT |

### Topics

Six, no more. A topic list is a discovery surface, but a padded one reads as
spam to a human reviewer at a curated directory — which is this repo's route to
reach.

```
claude-code
claude-code-plugin
claude-plugin
claude-code-skill
standup
developer-productivity
```

The first four are the topics existing Claude Code plugin repositories already
share, so the repo appears on the topic pages people browse. The last two name
the subject matter.

### Repository metadata command

The About description, homepage, and topics live in GitHub's settings, outside
version control. This is the command that produces the current state — re-run it
verbatim to restore the settings after any accidental change:

```bash
gh repo edit fireseasonnow/claude-plugins \
  --description "Claude Code plugins by fireseason. session-standup turns local session history into a standup report — what you finished and where it landed." \
  --homepage "https://github.com/fireseasonnow/claude-plugins" \
  --add-topic claude-code \
  --add-topic claude-code-plugin \
  --add-topic claude-plugin \
  --add-topic claude-code-skill \
  --add-topic standup \
  --add-topic developer-productivity
```

Rollback: before this change the description, homepage, and topics were all
empty. `gh repo edit ... --description "" --homepage ""` plus `--remove-topic`
for each of the six restores that state.

Verify with:

```bash
gh repo view fireseasonnow/claude-plugins \
  --json description,homepageUrl,repositoryTopics
```

---

## session-standup

Plugin names are **immutable once published**. This one is fixed.

| Field | Canonical value |
|---|---|
| Name | `session-standup` |
| Display name | `Standup` |
| Category | `productivity` |
| Homepage | `https://github.com/fireseasonnow/claude-plugins` |
| Author | `fireseason` |
| Keywords | identical to the repository topic list above |

### One-liner (≤ 80 chars)

> Turn Claude Code session history into a standup report.

### Short description (≤ 120 chars — GitHub About, directory cards)

> Turns local Claude Code session history into a standup report — what you finished and where it landed.

### Long description (plugin manifest, marketplace entry, directory submissions)

> Turn local Claude Code session history into a standup report — what you
> finished, which repos and branches it landed in, and which PRs or issues it
> touched. Reads ~/.claude/projects transcripts and runs read-only git locally;
> nothing leaves your machine.

The shorter forms are derived from this one by trimming, not rewritten. All
three keep the em-dash framing — *what you finished, which repos it landed in* —
because that is what separates this plugin from the tools that only read
commits.

---

# Submissions

**Status: `session-standup` submitted 2026-08-19** via the Console form,
awaiting review. Nothing else here has been submitted; each remaining venue is a
separate step needing the maintainer's go-ahead.

Verified 2026-08-19. Submission venues change; re-check each URL before using
the text below.

## 1. Anthropic community marketplace — primary

Submission targets **`claude-community`** only — the public community
marketplace, added by users with `/plugin marketplace add
anthropics/claude-plugins-community` and installed from as `@claude-community`.

**`claude-plugins-official` is curated by Anthropic at its own discretion.
There is no application process, and the submission form does not add plugins
to it.** Nothing here can influence that; treat it as out of reach.

**Submit at:** <https://platform.claude.com/plugins/submit> (Console form)

The alternative form at
`claude.ai/admin-settings/directory/submissions/plugins/new` requires a Team or
Enterprise organization with directory-management access. As an individual
author, use the Console form.

**Do not open a pull request** against `anthropics/claude-plugins-community`.
It is a read-only catalog synced nightly from the review pipeline, and PRs
opened against it are closed automatically.

**Process:** submit → `claude plugin validate` (the pipeline runs the same check
you run locally) → automated safety screening → review → approval. On approval
the plugin is pinned to a specific commit SHA in the community catalog, and CI
bumps that pin automatically as you push new commits. The catalog syncs
nightly, so expect a delay between approval and the listing appearing.

Check whether it is live by searching for `session-standup` in
<https://github.com/anthropics/claude-plugins-community/blob/main/.claude-plugin/marketplace.json>.

### Pre-submission checklist

| Criterion | Status |
|---|---|
| `claude plugin validate ./plugins/session-standup` passes | ✅ passes, and with `--strict` |
| Standard plugin layout (`.claude-plugin/plugin.json`, `skills/`, `README.md`) | ✅ |
| Documentation a reviewer can read | ✅ plugin README covers install, use, every flag, and redaction limits |
| Name is final (names are immutable once published) | ✅ `session-standup` |
| Security posture stated plainly | ✅ no network calls; reads all local transcripts; redaction documented as a safety net, not a guarantee |
| License present | ✅ MIT, repo root and plugin directory |

The safety screening will see a plugin that reads every session transcript on
the machine. That is inherent to what it does — the README and `SKILL.md` both
say so up front rather than leaving a reviewer to discover it.

### Submitted values (2026-08-19)

The form has two pages. What was sent:

| Field | Value |
|---|---|
| Link to plugin | `https://github.com/fireseasonnow/claude-plugins` |
| Path within repository | `plugins/session-standup` |
| Plugin homepage | `https://github.com/fireseasonnow/claude-plugins/tree/main/plugins/session-standup` |
| Plugin name | `session-standup` |
| Plugin description | the **directory description** below |
| Example use cases | three, below |
| Supported platforms | **Claude Code only** — not Cowork |
| License type | `MIT` |
| Privacy policy URL | `https://github.com/fireseasonnow/claude-plugins#privacy` |
| Email | the maintainer's deliverable address — **not** the GitHub `users.noreply.github.com` commit author, which cannot receive mail |

Cowork was left unchecked deliberately: the plugin reads
`~/.claude/projects/*.jsonl` and shells out to `node` and `git`, and it has not
been tested on that surface. Add it only after testing.

### Directory description

Longer than the manifest description because the directory form takes a
textarea. It expands the canonical long description; it must never contradict
it.

> Turn local Claude Code session history into a standup report — what you
> finished, which repos and branches it landed in, and which PRs or issues it
> touched.
>
> Most standup tools read your commits. This one reads what you were actually
> doing, so it still has something to say on a day you shipped nothing. It
> parses the transcripts Claude Code already writes to `~/.claude/projects`,
> corroborates them against `git log` so shipped work outranks activity, and
> writes the result as Yesterday / Today / Blockers, short enough to paste into
> Slack.
>
> Works retroactively — no hooks, no logging to set up, nothing to have
> remembered to turn on. Ask on your first day using it and it covers the week
> you already worked.
>
> Everything runs locally and the collector makes no network calls. It reduces
> megabytes of transcripts to a few kilobytes of digest, so your session history
> never enters the model's context — only the summary does. Known secret shapes
> (API keys, PEM keys, JWTs, credentials in URLs) are stripped before printing,
> and `$HOME` collapses to `~`.
>
> Requires Node 18+ or Bun. Zero dependencies.

### Example use cases

1. "Give me my standup" before the daily meeting — covers the previous working
   day plus this morning, grouped by theme rather than one bullet per session,
   with PR and issue numbers pulled from what you actually referenced.
2. "What did I do last week?" — a weekly recap across every project,
   corroborated against your commits so what shipped outranks what you merely
   opened.
3. "What did I work on in the payments repo since Monday?" — scoped to one
   project and an arbitrary window, for a status update or a self-review.

### After submission

- Approved plugins are pinned to a commit SHA in the community catalog; CI bumps
  the pin as new commits are pushed, so updates need no resubmission.
- The catalog syncs nightly, so expect a lag between approval and the listing.
- Check whether it is live:
  ```bash
  curl -sL https://raw.githubusercontent.com/anthropics/claude-plugins-community/main/.claude-plugin/marketplace.json \
    | grep -c '"session-standup"'
  ```
- Name availability was confirmed against all 2,281 catalog entries on
  2026-08-19: `session-standup` was free. Nearest neighbours are
  `standup-logger` (hook-based, logs as you go) and `repo-recap` (git only).
- Likeliest review question: why the plugin reads *all* projects rather than the
  current one. Answer: a standup spans repos; scoping to one project would miss
  most of the day.

## 2. `claudemarketplaces.com` — passive, no action needed

A public directory that indexes Claude Code plugin repositories from GitHub
rather than running a submission queue; no documented submit form as of the
verification date. **The repository topics set by this change are the
submission** — they are what an indexer keys on.

Re-check in a month. If the repo has not appeared, the site's feedback channel
is the fallback route.

## 3. Community "awesome" lists — opportunistic

PR-based lists (`awesome-claude-code` and its relatives) each define their own
row format. There is no draft to pre-write: the format is per-list, and a PR to
someone else's list is a small ask that should be made with a working link, not
in bulk.

**Draft row** (adapt to the target list's format):

```markdown
- [session-standup](https://github.com/fireseasonnow/claude-plugins) — turns local Claude Code session history into a standup report; runs entirely offline.
```

## Not targeted

- **`ananddtyagi/cc-marketplace`** — its submission portals
  (`claudecodecommands.directory/submit`, `subagents.cc`) are scoped to slash
  commands and subagents. This plugin ships a skill, so it is a poor fit and the
  incremental reach does not justify the listing.
- **Claude Enterprise Marketplace** — requires an Anthropic partnership and
  targets org-level software integrations. Not applicable.
