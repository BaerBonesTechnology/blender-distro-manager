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
- Mixar is included in the distribution list, with verified official macOS Apple Silicon and Linux x64 packages. Windows links to Mixar’s official MSI installer; use Scan installed builds after installation to adopt it.
- Choose and install Blender stable releases (3.x onward), including previous versions, or available official Beta/Alpha daily builds. Kitchen 3D offers its published release history with channel filters. Only packages matching this computer are listed. Kitchen 3D pre-releases are labeled. Downloads verify published SHA-256 checksums, retry up to three times, and install side by side. Cancel stops downloads; extraction finishes before cancellation cleanup.
- Three desktop tabs: Installed, Download, and Add-ons. Desktop supports system/light/dark themes; the website uses dark mode.
- Search the official Blender Extensions community catalog by name, tags, and maintainer. Install verified extension archives into the shared library. Search shows up to 60 matches; refine the query to find more.
- Shared library also supports local pure-Python legacy add-on folders containing `__init__.py`.
- Automatic availability across all managed installations using symlinks, or directory junctions on Windows. Synchronization runs when the library refreshes and before launch, including for newly installed builds. Community extensions use the system extension repository, with version and platform checks against the actual Blender executable. Shared add-ons are linked into each build’s normal user scripts/extension folders and automatically enabled on direct launches too. A small Blender startup module reads the saved per-executable checklist; the manager does not need to be running. Each add-on has an Enabled in checklist for persistent per-build exclusions; future compatible builds default to enabled. Restart open builds after changes. Compatibility for legacy local imports remains a manual check.
- Website hero, download availability page, distro directory, and submission form.
- SQLite submission queue. Public responses exclude maintainer contact. A reviewer approves entries before they become visible.
- Test-only CI for normal pushes and pull requests across Windows, Linux, and macOS. Version tags build and publish preview downloads after all three platforms pass their tests.

```sh
npm run review                # list pending submissions
npm run review -- approve 1
npm run review -- reject 2
```

Start the website once before using the review CLI. Website data defaults to `.data/`; override with `BDM_DATA`. Desktop data lives under Electron's application user-data directory. Back up these directories to preserve local state.

## Prototype boundaries

Releases provide portable archives; setup installers are not available yet. Update notifications, rollback controls, resumable downloads, wheel dependency installation, and maintainer authentication are planned. Linux tar.xz installation requires `xz` on PATH. macOS disk images use the built-in `hdiutil` and `ditto` tools. Unsupported OS/architecture combinations show an availability message. Shared add-ons must not write into their own source folder; writable legacy add-ons need a future private-copy mode. Profiles isolate preferences, not the execution of untrusted Python code.

The website binds to localhost. Do not expose it publicly yet: deployment requires authentication for maintainer tools, rate limiting, spam controls, abuse reporting, ownership verification, and operational hardening. Current catalog approval is editorial review, not a security audit. Source links lead to maintainers; binaries are not mirrored here.

## Structure

- `apps/desktop`: Electron shell and local manager interface.
- `apps/web`: local public-facing website, API, and review CLI.
- `packages/core`: installation/add-on library and seed catalog.
- `tests`: state, sharing, validation, and review regression tests.

See [ROADMAP.md](ROADMAP.md) for milestones and acceptance criteria. Product name is a working name; no Blender Foundation affiliation is implied.

## Manual browser and desktop smoke test

With the website running, install Playwright's Chromium (`npx playwright install chromium`) and run `node tests/smoke.mjs`. Alternatively set `CHROME_EXECUTABLE` to an existing Chrome executable. This checks all website routes, submits a clearly labeled pending test entry, checks mobile overflow, and starts the Electron window. Screenshots go to `.data/`. Review/reject the generated QA entry afterward.

## Standalone macOS app

Run `npm run package:mac` on macOS to produce an Apple Silicon `.app` and ZIP under `dist/`. Open **Blender Distro Manager.app** directly; it includes its runtime and does not need Node.js or a terminal on the test machine. It uses the same managed-installation library as the development launcher. This local test build is ad-hoc signed, not Developer ID signed or notarized for public distribution.

## Existing installations and uninstall

The manager scans standard installation locations once on first use. Installation paths and discovery completion are saved in `library.json` inside the desktop user-data `library/` directory; later launches load this file instead of rescanning. Existing populated libraries migrate without another automatic scan. On macOS it also detects local Blender/Kitchen build outputs under Documents/Projects. Use Scan installed builds to rescan or Locate existing installation for custom locations. Existing applications are adopted in place. Their native preferences remain untouched; add-on enablement is applied by the startup module without saving over the preferences file. The manager now launches builds with their native preference locations, just like direct launches. Existing copied manager profiles are retained but no longer used for launching.

Uninstall controls confirm the exact application path before moving the application/build to Trash and removing its manager profile. Close the build first. System executables without an isolated application folder must be removed with the OS package manager; the UI explains when it can only remove the manager entry. Uninstalling a shared add-on deletes its library copy and profile links, leaving the original local import source untouched.

## Publishing a preview release

Run `npm test` before tagging. Set `package.json` and `package-lock.json` to the release version, commit, then push a matching tag (for example `v0.1.0`). The Release workflow tests and packages macOS Apple Silicon, Windows x64, and Linux x64. It publishes a GitHub prerelease with archives and SHA-256 checksums only after every platform succeeds. Normal branch pushes do not produce release artifacts.

Use `npm run package` to package the current host platform locally. `npm run package:mac` remains available. Public macOS distribution still needs Developer ID signing and notarization; Windows builds are unsigned.

On macOS, managed installs automatically receive Applications shortcuts. Existing applications are preserved, additional versions get distinct names, and uninstall removes only the matching shortcut. If `/Applications` is not writable, the manager uses `~/Applications`.
