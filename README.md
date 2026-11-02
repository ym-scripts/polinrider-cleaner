# polinrider-cleaner

[![CI](https://github.com/ym-scripts/polinrider-cleaner/actions/workflows/ci.yml/badge.svg)](https://github.com/ym-scripts/polinrider-cleaner/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Find and remove the PolinRider malware from every GitHub repo you can reach.** `polinrider-cleaner` checks every branch of every repo you can access: personal, org and collaborator, public and private. It shows you exactly what it would change, and with `--apply` it commits the fix. It doesn't force-push, and it never runs code from the repos it scans.

```bash
npx github:ym-scripts/polinrider-cleaner            # dry run: report + one .patch per infected branch
```

```text
polinrider-cleaner  301 repos  DRY RUN  report: ./polinrider-report-2026-11-02T09-12-44

[WOULD-CLEAN     ] YoungMayor/sqlite-practice@main  reverted force-push 2026-10-18T18:56:31Z (a00c9ab9 -> original 801e9573)
[WOULD-CLEAN     ] MayR-Labs/studio-nextjs@main  removed: api.js, public/fonts/fa-solid-300.ttf, .vscode/tasks.json | cleaned: package.json
[OVERWRITTEN     ] YoungMayor/paylighter-nuxt@dev  branch OVERWRITTEN by force-push: original tip was 17e7feb2

Summary: OVERWRITTEN=48, SKIPPED-ARCHIVED=38, WOULD-CLEAN=242
```

No npm dependencies. Needs Node.js 18+, `git`, and the [GitHub CLI](https://cli.github.com) logged in (`gh auth login`). It works on macOS, Linux and Windows.

> [!WARNING]
> **Clean the machine first.** The malware pushes from a developer machine or with a stolen token. If you clean the repos before removing it, they are reinfected in the next wave. First revoke and reissue your GitHub tokens, check for `~/.node_modules/.npm-ws-runner.js`, and rotate any secret that a build running `node api.js` could have read.

## What the infection looks like

It amends the latest commit on a branch, keeps the author date (newer waves fake the committer date too), and force-pushes it. Across waves it has done the following:

| Change | Example |
| --- | --- |
| Adds a hidden payload file | root `api.js`: one line, about 300 tabs, then obfuscated JavaScript |
| Hides the payload at the end of a line in config files | `export default config;<300 tabs>…` in `postcss.config.mjs`, `vite.config.js`, `next.config.js`, `eslint.config.*`, `babel.config.js`, `tailwind.config.js`, … plus an injected `const require = createRequire(import.meta.url)` |
| Makes `npm run dev/build/start` run the payload | `"dev": "node api.js && next dev"` |
| Marks itself in `.gitignore` | `branch_structure.json`, `temp_auto_push.bat`, `temp_interactive_push.bat`, sometimes `.gitignore` itself |
| Runs when the folder is opened in VS Code | `.vscode/tasks.json` with `"runOn": "folderOpen"` running `node ./public/fonts/fa-solid-500.woff2` (also `fa-solid-300.ttf`, `fa-solid.lfk`), plus decoy `.vscode/*` files, FontAwesome fonts and a "Blockchain Explorer" `public/fonts/README.md` |
| Overwrites whole branches | `dev` or `feature/*` reset to `main`'s infected commit |

## How it cleans

For each infected branch, safest method first:

1. **Exact undo.** GitHub's [repository activity log](https://docs.github.com/rest/repos/repos#list-repository-activities) keeps the commit each force-push replaced. If the attacker's commit is still in the branch, the tool reverses exactly that change and adds it as a new commit on top. It only does this when every file it touches is a known infection file. The attacker sometimes amends a commit that also contains your own unpushed work, and that work is never reverted.
2. **Signature cleanup.** This handles older infections and anything step 1 skipped. It removes the payload files and tasks, cuts the hidden tails, deletes the `createRequire` shim when nothing else uses it, and removes the `node api.js &&` script prefix and the `.gitignore` markers. Decoy fonts are kept if anything else in the repo references them.
3. **Verify.** The tool re-scans exactly what would be committed. If any signature is still there, the branch is reported as `MANUAL` and not pushed.

Fixes land as a normal fast-forward commit: `security: remove PolinRider malware injection`. The malware stays in older history, so don't check out or run infected commits. Branches the attacker **overwrote** are only reported, unless you pass `--restore-overwritten`. That puts them back on their original tip with `--force-with-lease`, which only succeeds if the branch still points at the attacker's commit.

While it scans, git hooks are disabled, nothing is installed and no project scripts run.

## Usage

```bash
polinrider-cleaner                                        # dry run over everything
polinrider-cleaner -r YoungMayor/sqlite-practice --apply  # fix one repo
polinrider-cleaner -o YoungMayor -o MayR-Labs --apply --restore-overwritten
polinrider-cleaner -o some-team-org --apply --via-pr      # shared repos: open PRs instead
```

Review the `.patch` files in the report folder before you run with `--apply`.

### Options

| Option | Description |
| --- | --- |
| `--apply` | Commit and push the fixes. Without it, nothing is pushed. |
| `--via-pr` | With `--apply`: push to `security/remove-polinrider-<branch>` and open a PR instead. |
| `--restore-overwritten` | Put wholesale-overwritten branches back on their original tip (`--force-with-lease`). |
| `-r`, `--repo OWNER/NAME` | Only this repo. Repeatable. |
| `-o`, `--owner NAME` | Only repos owned by this user or org. Repeatable. |
| `-b`, `--branch NAME` | Only this branch. |
| `--include-forks` | Also scan forks. |
| `-j`, `--jobs N` | Repos processed in parallel. Default `6`. |
| `--out DIR` | Report folder. Default `polinrider-report-<timestamp>`. |
| `-y`, `--yes` | Don't ask before pushing. |
| `-v`, `--version` / `-h`, `--help` | Version / help. |

### Statuses

| Status | Meaning |
| --- | --- |
| `WOULD-CLEAN` / `CLEANED` / `PR-OPENED` | A fix was found, or pushed, or opened as a PR |
| `OVERWRITTEN` / `WOULD-RESTORE` / `RESTORED` | The branch was replaced wholesale; restore needs `--restore-overwritten` |
| `MANUAL` | Not touched: still infected after cleaning, or the history moved on. Fix it by hand. |
| `NO-PUSH-ACCESS`, `PUSH-FAILED` | You can't push to it, or a protected branch rejected the push. Try `--via-pr`. |
| `SKIPPED-ARCHIVED` | Archived repos are read-only. Unarchive them to clean. |
| `ERROR` | The clone or API call failed. Run again for that repo. |

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Nothing left to fix |
| `1` | Infections found (dry run), or some branches still need attention |
| `2` | Usage error, or `git`/`gh` not ready |

## Development

```bash
npm test     # node:test, offline, harmless synthetic fixtures
```

## License

[MIT](LICENSE) © Aghogho Meyoron
