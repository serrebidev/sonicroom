# SonicRoom update issues: agent playbook

The hourly `sonicroom-updater.timer` runs `/usr/local/sbin/sonicroom-update`. It rebuilds
calls.serrebiradio.com from upstream `origin/main` (github.com/ogomez92/sonicroom) plus every
fork branch listed in `/var/lib/sonicroom/deploy-branches` (github.com/serrebidev/sonicroom).
When an update causes a problem it appends a record here and to the journal. Your job:
brainstorm, investigate, fix, and restart if possible, then confirm the issue resolves.

## 1. Find open issues

- `/var/lib/sonicroom/update-issues.jsonl`: one JSON object per line. An open issue has
  `"status": "open"`. When a later run no longer raises it, a `"status": "resolved"` line
  with the same kind, branch and message follows.
- `/var/lib/sonicroom/update-issues.open`: signatures of issues still open (empty or missing = none).
- `journalctl -u sonicroom-updater -p err --no-pager`: the same records, as lines starting
  `UPDATE-ISSUE {`. Full build output: `journalctl -u sonicroom-updater --since "-2h" --no-pager`.

Fields: at, status, kind, severity, message, branch, inputs (base and branch heads), still_serving
(the last successfully deployed commit), logs.

## 2. Investigate by kind

- `update-failed`: the run stopped. The message is the refusal or the failing command and line.
  If the failure came before the dist swap (install, lint, tsc, build), the previous build keeps
  serving. A failed health check comes after the swap, so check `systemctl status sonicroom` and
  `journalctl -u sonicroom -n 100` first, because the site may be down.
- `branch-conflict`: an unmerged fork branch conflicts with new upstream main and was skipped,
  so its feature is NOT live, while everything else deployed. Fix: rebase the fork branch onto
  `origin/main`, resolve the conflict, run its tests, and force-push it to the fork. If its
  upstream PR is open, the rebase updates the PR.
- `tests-failed`: upstream server tests failed but the deploy continued. Check whether upstream
  broke them (then leave it) or an overlay branch did (then fix the branch). Seven lifecycle tests
  in `audio-sources.test.ts` were already cancelled on plain upstream on 2026-09-25, and that
  is not a regression.

## 3. Fix

- Never edit or build in `/var/www/sonicroom` as root, and never leave tracked changes there,
  because the updater refuses to run on a dirty tree or on any branch except `deploy`. Run git
  as the app user: `runuser -u sonicroom -- git -C /var/www/sonicroom ...`.
- Work on fork branches in a separate clone (for example in a scratch directory), push to
  `serrebidev/sonicroom` (`gh` is logged in as serrebidev), and let the updater merge them.
  Test with `server/node_modules/.bin/tsc` and `node --import tsx --test` from the live
  `node_modules` (symlink it). Do not use `pnpm exec` in a copied tree.
- Upstream bugs get a PR to ogomez92/sonicroom from a fork branch, and a line in
  `deploy-branches` keeps the fix live until the PR merges. The updater prunes that line by
  itself once the PR merges or the branch is deleted, so don't remove lines by hand for that.
- Keep the blank line after the header comment in `deploy-branches`.

## 4. Restart and verify

- Re-run the updater: `systemctl start sonicroom-updater.service`, then check it with
  `journalctl -u sonicroom-updater -n 30 --no-pager`. Don't restart the timer.
- Health: `curl -s 127.0.0.1:3100/health` should return `{"status":"ok",...}`.
- The issue is fixed when a `"status": "resolved"` line for it appears in the JSONL.
- Audio proxy smoke test (uses one IPTV connection, so stop after a few seconds):
  `curl -s --max-time 10 -o /tmp/p.webm "http://127.0.0.1:3100/api/audio-proxy?url=<urlencoded>"`,
  then run `ffprobe /tmp/p.webm`. It should show stereo opus.
- Restarting `sonicroom` drops live calls for a few seconds. Check first with
  `ss -Htn state established '( sport = :3100 )'`.
