# Product and delivery plan

## 1. Local foundation — initial prototype

Desktop launcher, isolated preferences, explicit shared add-on assignments, website, and persistent moderated submissions. Validate on a real Blender installation. Current tests cover persistence, profile links, rejected binary add-ons, unsafe metadata, and review privacy. Desktop platform support still needs native manual validation.

## 2. Download and installation engine

Define a versioned release manifest: distro ID, release/version, upstream Blender version, channel, OS/architecture, HTTPS asset URL, SHA-256, archive format, relative executable, provenance. Provider adapters for official Blender and GitHub releases feed the same catalog.

Implement resumable downloads with validators, bounded retry/backoff, cancel, checksum verification, disk space checks, traversal-safe extraction, staging, atomic installation, and recovery. Never execute post-install scripts from submitted manifests. Support ZIP, tar.xz, and macOS packages explicitly. Acceptance: interrupted download resumes safely; corrupt archive leaves previous installation usable; launches on each supported platform.

## 3. Shared add-on center

Versioned immutable package store. Parse extension manifests and legacy metadata; check Blender version ranges, platform, Python ABI, and wheels. Install wheels through Blender-supported mechanisms in separate environments. Global default collection plus per-profile pins/exclusions. Opt-in private copies for writable legacy add-ons. Track assignments and allow detach/removal. Acceptance: compatible builds share packages; incompatible builds explain the conflict; updating one profile cannot break a pinned profile.

## 4. Updates and recovery

Notify about release availability, show changes and sizes, install beside the current version, switch the launch target after verification, retain rollback. Never replace a running executable. Separate manager updates from distro updates. Full downloads first; content-addressed/delta delivery later with full-download fallback.

## 5. Public website and maintainer system

Hero and manager downloads with OS/architecture, release notes, checksums, and signatures. Search/filter distro directory; detail pages with screenshots, channels, upstream version, and platform availability. Authenticated maintainer dashboard, ownership verification, public/unlisted visibility, editable draft submissions, validation, human review, audit history, and reporting. Distinguish community-submitted, ownership-verified, and installation-tested badges. Host metadata initially; retain binaries on maintainer infrastructure. Never label review as a malware guarantee.

## 6. Release readiness

Signed desktop packages, updater signing and trust policy, accessibility and keyboard QA, OS-level smoke tests, install/uninstall and rollback tests, license/dependency review, privacy policy, backups, and monitoring. Website deployment and GitHub repository creation require an explicit destination; neither has been provisioned yet.

## Architecture decisions

Desktop owns local installations and package storage. Website owns catalog and submissions. A versioned catalog contract joins them; local files remain usable offline. User settings stay per-profile. Do not mutate installed Blender app bundles. A shared collection means shared compatible package versions, not identical enabled settings across incompatible Blender versions.
