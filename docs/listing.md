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

> **Nothing below has been submitted.** These are prepared drafts. Submitting is
> a separate step that needs the maintainer's explicit go-ahead — a submission
> attaches a review record to a real person's name, and it cannot be quietly
> undone.

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

### Form values

| Field | Value |
|---|---|
| Plugin name | `session-standup` |
| Display name | `Standup` |
| Repository / source | `https://github.com/fireseasonnow/claude-plugins` |
| Plugin path in repo | `plugins/session-standup` |
| Category | Productivity |
| Description | the **long description** above, verbatim |
| Short description | the **short description** above, verbatim |
| Author | fireseason |
| License | MIT |

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
