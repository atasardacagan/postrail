# Source publication audit

Run `npm run audit:source` before creating a public commit, repository, or source archive. This dependency-free audit detects a bounded set of high-confidence provider-key formats, private-key PEM markers, personal home-directory paths, and forbidden environment/runtime files. Findings contain **only a filename and rule ID**. It does not print matching values, source excerpts, or raw Git errors.

## Scope

When this project is its own Git repository, the audit checks:

- Current tracked files, plus untracked files not excluded by Git ignore rules.
- Exact staged blobs, so a staged credential cannot be hidden by subsequently editing the working copy.
- Every distinct path/blob version in every commit reachable from Git refs and `HEAD`, including content deleted from later commits.

Ignored files already tracked in Git remain in scope. Environment files other than `.env.example`, runtime databases, dependencies, compiled output, private-key files, and logs fail if they appear in publication files or history. Binary files are checked for embedded ASCII/UTF-8 patterns; media is not decoded or OCR-scanned. Symlinks in the working copy are not followed, and submodules require separate review. Unsupported or unreadable content makes the audit fail rather than silently claiming completion.

Before Git initialization, the audit checks source candidates while excluding known private/generated paths. It states that Git history is unavailable. **Re-run after staging and committing**: a source-only pass is not evidence that the index or history is safe. The audit does not initialize, stage, rewrite, or modify Git history.

## Synthetic test fixtures

Tests are scanned under the same rules as application code. Two existing non-live doctor fixtures have narrow exceptions in `scripts/audit-source.mjs`: one OpenAI-shaped value and one Telegram-shaped value, both in `tests/doctor.test.ts`. Each exception binds the exact path, rule ID, and SHA-256 digest of the entire matched value. Changing the value, adding another provider-shaped value, or moving it to a different file is not covered.

These fixtures exercise local credential-format diagnostics and do not call providers. There is no test-directory wildcard, blanket token-prefix exclusion, or inline “skip secrets” mechanism. Reviewers should only add an exception for an independently verified synthetic value and document its purpose. An exception must never be used to retain a real exposed credential; revoke the credential and remove it from publication scope and history instead.

## Results and limits

Exit code `0` means the stated scope passed the implemented rules. Exit code `1` means findings or incomplete inspection. Missing Git history is prominently reported; it is not described as scanned.

This is **not a complete secret scanner**. Arbitrary passwords, unknown/new provider token formats, encrypted secrets, encoded credentials, image contents, remote refs not fetched locally, reflogs, and unreachable/dangling Git objects are outside its detection guarantees. It does not determine whether a provider-shaped value is live by contacting the provider. Use provider secret scanning and a broader history scanner as additional release controls when available. Review artifacts and archive exclusions separately before publication.
