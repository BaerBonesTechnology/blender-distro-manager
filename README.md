# Blender Distro Manager

A separate, independent project for managing Blender distributions and sharing add-ons across installations. Kitchen 3D is one catalog entry; this repository does not change or build Kitchen 3D.

## Run the local preview

Requires Node.js 24+ and npm.

```sh
npm install
npm start              # Electron desktop manager
npm run web            # http://127.0.0.1:4310
npm test
```

On macOS, select the executable inside `Blender.app/Contents/MacOS/Blender` (or the equivalent distro bundle). Importing records an existing executable, not a copy of the installation. Only import executables and add-ons you trust.

## Working now

- Desktop import and launch of existing installations with separate configuration and scripts directories.
- Shared library for pure-Python legacy add-on folders containing `__init__.py`.
- Explicit per-installation add-on assignment using symlinks, or directory junctions on Windows. Enable the assigned add-on in Blender preferences. Compatibility is currently a manual check.
- Website hero, download availability page, distro directory, and submission form.
- SQLite submission queue. Public responses exclude maintainer contact. A reviewer approves entries before they become visible.
- Test-only CI across Windows, Linux, and macOS. No packaging or release workflow.

```sh
npm run review                # list pending submissions
npm run review -- approve 1
npm run review -- reject 2
```

Start the website once before using the review CLI. Website data defaults to `.data/`; override with `BDM_DATA`. Desktop data lives under Electron's application user-data directory. Back up these directories to preserve local state.

## Prototype boundaries

No public installers exist yet: the download page says so. Automatic binary download/install, updates, rollback, add-on compatibility detection, extension manifests/wheels, and maintainer authentication are planned. Shared add-ons must not write into their own source folder; writable legacy add-ons need a future private-copy mode. Profiles isolate preferences, not the execution of untrusted Python code.

The website binds to localhost. Do not expose it publicly yet: deployment requires authentication for maintainer tools, rate limiting, spam controls, abuse reporting, ownership verification, and operational hardening. Current catalog approval is editorial review, not a security audit. Source links lead to maintainers; binaries are not mirrored here.

## Structure

- `apps/desktop`: Electron shell and local manager interface.
- `apps/web`: local public-facing website, API, and review CLI.
- `packages/core`: installation/add-on library and seed catalog.
- `tests`: state, sharing, validation, and review regression tests.

See [ROADMAP.md](ROADMAP.md) for milestones and acceptance criteria. Product name is a working name; no Blender Foundation affiliation is implied.

## Manual browser and desktop smoke test

With the website running, install Playwright's Chromium (`npx playwright install chromium`) and run `node tests/smoke.mjs`. Alternatively set `CHROME_EXECUTABLE` to an existing Chrome executable. This checks all website routes, submits a clearly labeled pending test entry, checks mobile overflow, and starts the Electron window. Screenshots go to `.data/`. Review/reject the generated QA entry afterward.
