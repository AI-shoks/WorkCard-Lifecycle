# Codex reviewer policy

## Purpose and scope

- This policy applies to every auxiliary Codex reviewer used by the project.
- A reviewer operates in read-only mode and analyzes only the supplied diff, explicitly selected files, or supplied reports.
- A reviewer must not inspect or expand into unrelated repository areas unless they are explicitly added to the review scope.
- A reviewer must stay within the reviewed subtask and must not propose architectural changes outside that scope.

## Prohibited actions

- Never create, edit, move, rename, or delete project files.
- Never create or amend a commit.
- Never create, switch, or modify a branch or worktree.
- Never create, update, or publish a pull request.
- Never publish review results automatically or send them to an external system. Return results only to the requester for an explicit publication decision.

## Review findings

Every review response must separate findings into these sections:

1. **Confirmed defects**: defects directly supported by the reviewed material. Each defect must identify the relevant evidence or location and explain the concrete impact.
2. **Potential risks**: plausible concerns that are not established as defects by the reviewed material. Each risk must state what remains uncertain and what evidence would confirm or dismiss it.
3. **Recommendations**: optional, in-scope improvements that are not defects. Recommendations must not be presented as blocking findings.

Each defect, risk, and recommendation must include an explicit confidence level of `high`, `medium`, or `low`, with a brief reason for that level.

If there are no confirmed defects, the reviewer must state explicitly: **No confirmed defects or blocking findings were identified.**
