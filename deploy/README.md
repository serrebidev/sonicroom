# SonicRoom deployment (serrebiradio.com)

This directory is the version-controlled copy of the deployment machinery that
runs on the VPS. It is not part of the upstream application; it is the
instance-local overlay that keeps `/var/www/sonicroom` running from upstream
`main` plus the fork branches listed in `deploy-branches`.

Nothing here is deployed to end users — the client never sees this directory.

## Files

| File | Installed to | Purpose |
|---|---|---|
| `sonicroom-update` | `/usr/local/sbin/sonicroom-update` | The whole updater: fetch, prune, merge, build, test, health-check, record. |
| `sonicroom-updater.service` | `/etc/systemd/system/` | `Type=oneshot` unit that runs the script. |
| `sonicroom-updater.timer` | `/etc/systemd/system/` | Hourly timer (`OnUnitActiveSec=1h`, `Persistent=true`, 5 min jitter). |
| `AGENTS.md` | `/var/lib/sonicroom/AGENTS.md` | Playbook the script points AI agents at when an update fails. |
| `deploy-branches.example` | `/var/lib/sonicroom/deploy-branches` | Template for the overlay branch list. |

## How a deploy works

The live tree is a local branch `deploy`, **regenerated from scratch every run**
as:

```
origin/main  +  merge(fork branch 1)  +  merge(fork branch 2)  ...
```

`deploy` is never hand-edited. Anything you want on the server is a branch on
the fork, listed in `deploy-branches`.

Three properties fall out of that, and they are the reason it is built this way:

- **Unmerged upstream PRs stay live.** A feature branch keeps deploying until
  upstream accepts it. Once its PR merges, the branch is pruned automatically
  (ancestry check, tree check, or the GitHub PR API) and its line disappears
  from `deploy-branches`.
- **A conflicting branch never blocks updates.** If a listed branch conflicts
  with upstream it is skipped for that run with a `branch-conflict` warning;
  the rest still deploy. The script then re-tries it whenever either side moves.
- **No-op runs are free.** The inputs (base head + each branch head) are hashed
  into `deployed-inputs`; if nothing moved, the run exits before touching the
  build. That is why an hourly timer is affordable.

## Gates before a restart

In order: `pnpm install --frozen-lockfile` → paraglide compile →
`pnpm --filter server test` → `pnpm --filter client test` → `pnpm lint` →
server `tsc --noEmit` → client `tsc -b` → server build → client build.

Test and lint failures log an issue and **continue**; a hard failure (compile,
install, merge) aborts and leaves the previous deployment serving.

The service is only restarted when `server/`, `package.json`, `pnpm-lock.yaml`
or `pnpm-workspace.yaml` differ from the last deployed commit. A client-only or
docs-only change rebuilds the bundle and swaps `dist` without a restart.

After the swap the script polls `http://127.0.0.1:3100/health` for 20 s and only
then advances `deployed-commit`. **A failed health check leaves the old commit
recorded** — that is the signal that the live tree is not what the state file
claims.

## Installed paths

| Path | Owner | Notes |
|---|---|---|
| `/var/www/sonicroom` | `sonicroom` | The app. `data/` is the only writable path inside the tree. |
| `/var/lib/sonicroom/` | `sonicroom` | `deploy-branches`, `deployed-commit`, `deployed-inputs`, `update-issues.jsonl`, TURN overlay metadata. |
| `/var/lib/sonicroom/home` | `sonicroom` | `HOME` for the build user, so corepack/pnpm caches land here. |
| `/var/lib/sonicroom/tmp` | `sonicroom` | `TMPDIR` for the build. On this VPS `/tmp` is a small tmpfs. |

**Ownership matters.** The build runs as `sonicroom`. Any root-owned file in
`client/dist`, `client/src/paraglide` or `server/dist` makes the next deploy
fail with `EACCES`, because the script has to unlink and replace those trees.
If a deploy fails on permissions, `chown -R sonicroom:sonicroom` those three
paths.

## Editing this on a live box

Edit here, then:

```sh
install -o root -g root -m 0755 deploy/sonicroom-update /usr/local/sbin/sonicroom-update
install -m 0644 deploy/sonicroom-updater.{service,timer} /etc/systemd/system/
install -o root -g root -m 0644 deploy/AGENTS.md /var/lib/sonicroom/AGENTS.md
systemctl daemon-reload
bash -n /usr/local/sbin/sonicroom-update   # always: a syntax error bricks the timer
```

## Checking state

```sh
cat /var/lib/sonicroom/deployed-commit      # what is actually live
cat /var/lib/sonicroom/deployed-inputs      # base + branch heads it was built from
cat /var/lib/sonicroom/update-issues.jsonl  # every open/resolved issue, one JSON per line
cat /var/lib/sonicroom/update-issues.open   # signatures still open
journalctl -u sonicroom-updater --since "-2h" --no-pager
```

`deployed-commit` and `deploy`'s HEAD should agree. If they do not, the last
run failed after the swap — check the health endpoint before trusting either.