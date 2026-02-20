# Claude Hub Session Instructions

## CI Monitoring

After pushing commits and creating or updating a pull request,
your task is NOT complete until CI passes.

1. Wait for checks: `gh pr checks <PR_NUMBER> --watch --fail-fast`
2. Exit code 0 → CI passed, proceed to completion.
3. Exit code 1 → CI failed:
   a. `gh run list --branch <branch> --limit 5 --json databaseId,name,conclusion`
   b. `gh run view <RUN_ID> --log-failed`
   c. Read the failing test code, not just the error message.
   d. Fix, commit, push, return to step 1.

Assume CI always passes on main. Any failure on your branch
is yours to fix.

Maximum 3 fix-and-retry cycles. After 3 failures, comment on
the PR explaining what failed and what you tried, then stop.
