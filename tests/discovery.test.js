import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Library } from "../packages/core/library.js";
import { listReleases, discover } from "../packages/core/releases.js";

test("scan runs once across restarts, keeps paths, and manual scan still works", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bdm-discovery-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let scans = 0;
  const scanner = async () => {
    scans++;
    return [{ executable: "/example/Mixar", name: "Mixar", distro: "mixar" }];
  };
  const first = new Library(root, { scanner });
  await Promise.all([first.initialize(), first.initialize()]);
  const saved = (await first.read()).installs;
  const reopened = new Library(root, { scanner });
  await reopened.initialize();
  assert.equal(scans, 1);
  assert.deepEqual((await reopened.read()).installs, saved);
  await reopened.detect();
  assert.equal(scans, 2);
  assert.deepEqual((await reopened.read()).installs, saved);
});
test("empty first scan is remembered and old populated libraries migrate without scanning", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bdm-discovery-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let scans = 0;
  const scanner = async () => {
    scans++;
    return [];
  };
  await new Library(root, { scanner }).initialize();
  await new Library(root, { scanner }).initialize();
  assert.equal(scans, 1);
  const legacy = new Library(path.join(root, "old"), { scanner });
  await legacy.update((s) =>
    s.installs.push({ id: "existing", executable: "/saved/Blender" }),
  );
  await legacy.initialize();
  assert.equal(scans, 1);
  assert.equal((await legacy.read()).installs[0].executable, "/saved/Blender");
});
test("failed scan does not mark discovery complete", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bdm-discovery-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let attempts = 0;
  const library = new Library(root, {
    scanner: async () => {
      if (++attempts === 1) throw Error("unavailable");
      return [];
    },
  });
  await assert.rejects(library.initialize(), /unavailable/);
  assert.equal((await library.read()).discoveryCompletedAt, undefined);
  await library.initialize();
  assert.equal(attempts, 2);
});
test("Mixar matches official platform assets, checksums and channels; never extracts MSI", async () => {
  const releases = [
    {
      tag_name: "v4.3.4",
      name: "Mixar",
      assets: [
        "Mixar-4.3.4-arm64.dmg",
        "Mixar-4.3.4-linux-x86_64.tar.xz",
        "Mixar-4.3.4-x64.msi",
      ].map((name) => ({
        name,
        digest: "sha256:" + "a".repeat(64),
        browser_download_url:
          "https://github.com/Mixar-AI/mixar-app/releases/download/v4.3.4/" +
          name,
      })),
    },
  ];
  const fetcher = async (url) => {
    assert.match(url, /repos\/Mixar-AI\/mixar-app\/releases/);
    return Response.json(releases);
  };
  const mac = await discover("mixar", {
    platform: "darwin",
    arch: "arm64",
    fetcher,
  });
  assert.equal(mac.name, "Mixar");
  assert.equal(mac.sha256, "a".repeat(64));
  assert.equal(mac.filename, "Mixar-4.3.4-arm64.dmg");
  assert.equal(
    (await listReleases("mixar", { platform: "linux", arch: "x64", fetcher }))
      .length,
    1,
  );
  for (const options of [
    { platform: "win32", arch: "x64" },
    { platform: "darwin", arch: "x64" },
    { platform: "linux", arch: "arm64" },
    { platform: "darwin", arch: "arm64", channel: "Beta" },
  ]) {
    assert.deepEqual(await listReleases("mixar", { ...options, fetcher }), []);
  }
});
