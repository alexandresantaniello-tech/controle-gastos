---
name: sifia-continuity
description: Preserve and recover continuity for every Sifia task, including app, social networks, editorial pilots, n8n, accounts, launch operations, and pauses. Use before resuming, changing, approving, pausing, or reporting Sifia work.
---

# Sifia Continuity

Treat repository files under `project-governance/` as the operational source of truth. Memory and chat recollection are discovery aids, never authoritative evidence.

## Start or resume work

Before proposing or executing Sifia work:

1. Read `project-governance/SIFIA_STATE.md` completely.
2. Read `project-governance/SIFIA_DECISIONS.md` completely.
3. Identify the active work item, its evidence, authorization, last completed step, and next step.
4. Show the user a compact header containing: current objective, last verified delivery, current action, and next checkpoint.
5. If the requested task conflicts with a recorded rule, stop and expose the conflict.
6. If a required fact is missing or marked `INCERTO`, do not infer it. Recover evidence or ask the user.

## Evidence rules

- Mark a claim `CONFIRMADO` only when supported by a repository commit, accessible service state, persistent artifact, or explicit user approval that can be located.
- Mark incomplete recovery as `INCERTO`.
- Mark superseded decisions `SUBSTITUÍDO`, preserving the replacement reference.
- Never convert a plan, authorization, or remembered conversation into a completed task without execution evidence.
- Newer explicit user decisions supersede older ones only after being added to `SIFIA_DECISIONS.md`.

## Complete work

After every material delivery:

1. Record the evidence and result in `SIFIA_STATE.md`.
2. Record any new or superseding decision in `SIFIA_DECISIONS.md`.
3. Set one next action. Do not leave multiple items described as active.
4. Continue automatically only when the next action is already authorized and reversible.
5. Ask before spending money, publishing, merging to production, changing access, or taking another consequential external action.

## Pause protocol

When the user says `pausa`, `vou parar`, `continuamos depois`, or equivalent:

1. Stop starting new work.
2. Finish or safely stop the current operation.
3. Update `SIFIA_STATE.md` with:
   - timestamp;
   - objective;
   - last completed step and evidence;
   - current incomplete step;
   - exact next action;
   - pending approvals;
   - blockers;
   - files, branches, services, and artifacts touched.
4. Return a short checkpoint to the user.
5. On return, resume only from that checkpoint.

## Domain boundaries

- Keep Sophie completely outside Sifia work unless Fernando explicitly reintroduces her.
- Do not treat editorial content as product advertising unless a recorded decision authorizes it.
- Preserve authorization boundaries for deploys, publication, costs, account changes, and sensitive data.

