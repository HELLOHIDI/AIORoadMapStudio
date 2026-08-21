# Repository delivery policy

This repository uses a mandatory agent GitHub delivery loop for every `$ultragoal` code change. Treat this file as the execution contract. App-specific behavior remains governed by `roadmap-demo/AGENTS.md` and `roadmap-demo/DESIGN.md`.

## Mandatory Ultragoal loop

One Ultragoal request is one self-contained GitHub Issue, one work branch, and one evidence-focused pull request.

```text
Issue -> branch from origin/master -> implement -> verify
  -> PR -> required CI -> squash merge -> delete branch
  -> save Sites version from merged SHA -> private deploy
  -> verify deployment -> record evidence -> close Issue
```

The work is not complete at local implementation, commit, push, PR creation, or merge. Do not claim completion until the exact merged `origin/master` SHA has been privately deployed, deployment success has been verified, evidence has been recorded on the Issue, and the Issue has been closed.

This agent policy is not a substitute for GitHub enforcement. Branch protection/rulesets and auto-merge must be configured separately when the repository plan permits them. If GitHub rejects those settings because of plan or permission limits, record the failure, keep structural-enforcement work incomplete, and never describe manual squash merging as equivalent enforcement.

## Start and branch rules

- Create the Issue before creating the work branch. The Issue must include the outcome, scope, non-goals, acceptance criteria, and Ultragoal goals; do not publish private transcripts, credentials, or local `.omx` ledgers.
- Start from the current `origin/master`, not a stale local `master`.
- Name the branch `<type>/<issue-number>-<short-slug>`, where `<type>` is `feat`, `fix`, or `chore`.
- Keep one request's work on its Issue branch. Split only when work is independently deployable or has materially different rollback risk.
- Direct pushes to `master` are prohibited. Never force-push or rewrite shared history.
- Every task commit must be pushed to its tracked remote branch before reporting progress that implies it is available remotely. Verify with `git rev-parse HEAD` and `git rev-parse @{upstream}`.

## Issue and PR rules

- Issue title: `[feat]`, `[fix]`, or `[chore]` followed by an outcome-oriented title.
- PR title matches the Issue title.
- PR body uses `Refs #<issue-number>` before merge and contains only the material change, pre-merge checks, and deployment considerations. Do not use an auto-closing keyword before deployment is complete.
- After merge, record the exact merged SHA, Sites version ID, deployment ID/status, private URL, and timestamp on the Issue. Close the Issue only after successful private deployment evidence exists.
- If validation, permissions, Sites save/deploy, verification, or Issue evidence posting fails, leave the Issue open and do not claim completion. Create a corrective PR linked with `Refs #<issue-number>` when needed.

## Required verification

Before a PR can merge, run and pass the existing checks:

```text
npm test                 (working directory: roadmap-demo)
npm run build            (working directory: roadmap-demo)
npm run test:sites       (working directory: roadmap-demo)
git diff --check
```

The required GitHub check is `CI / verify` from `.github/workflows/ci.yml`. Inspect and poll this real workflow only; do not create, update, duplicate, or bypass required checks. Include the commands and results in the PR.

## Merge and Sites rules

- When all required checks pass and the Issue acceptance criteria are satisfied, enable auto-merge with squash and branch deletion when the repository supports it. If auto-merge is unavailable, record that structural limitation and use a deliberate squash merge only as the documented operational fallback.
- Use the exact resulting `origin/master` commit as the Sites source. Save one Sites version, deploy it privately, poll until success or failure, and record the evidence on the Issue.
- A public or shared deployment always requires explicit user approval. A private deployment failure keeps the Issue open and blocks completion.
- After a successful private deployment and evidence update, close the Issue. A new request starts a new Issue, branch, PR, and private deployment.

## Boundaries and escalation

The agent may create/update Issues, branches, commits, PRs, private Sites versions/deployments, deployment evidence, and Issue closure within this loop. It may inspect/poll required checks but must not create, update, duplicate, or bypass their status.

Stop and escalate when credentials or permissions are missing, required checks cannot pass without changing scope, recovery would be destructive or irreversible, deployment would become public/shared, branch protection would be weakened, or a failure requires a materially different feature or rollback decision.

Stale branch cleanup is not part of ordinary Ultragoal completion. Do not delete `archive/*`, old `codex/*`, unrelated `agent/*`, or `backup/*` branches without explicit approval.

## Evidence-first completion gate

Before marking an Ultragoal complete, confirm all of the following:

- The Issue, branch, PR, merged commit, and deployment refer to the same request.
- The work is pushed and the relevant local and remote SHA values match at each handoff.
- Required CI passed on the PR head.
- The PR was squash-merged into `master` and the current work branch was deleted.
- The deployed Sites version was created from the exact merged `origin/master` SHA.
- Private deployment succeeded and its URL/status/timestamp are recorded on the Issue.
- The Issue is closed only after the preceding evidence exists.

If any item is missing, the status is incomplete or blocked; never convert it into a success claim by assumption.
