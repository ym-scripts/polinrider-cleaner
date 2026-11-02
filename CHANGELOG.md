# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org).

## [0.1.0] - 2026-11-02

### Added
- Scan every branch of every repo you can reach (personal, orgs, collaborator; public and private) for the PolinRider injection.
- Exact undo of each infecting force-push, using the original commit from GitHub's repository activity log.
- Signature cleanup for older infections: hidden `api.js`, payloads hidden after hundreds of tabs in config files, `package.json` scripts that run `api.js`, `.gitignore` markers, VS Code auto-run tasks and fake font files.
- Re-scan before every push. A branch that still matches any signature is reported as `MANUAL` and left alone.
- `--restore-overwritten` to put branches the attacker replaced wholesale back on their original tip, with `--force-with-lease`.
- Dry run by default, with one `.patch` per branch and `report.json`. `--apply` and `--via-pr` to push.
