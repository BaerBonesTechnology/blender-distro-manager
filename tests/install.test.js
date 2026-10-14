import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { Library } from "../packages/core/library.js";
import { install, safePath } from "../packages/core/installer.js";
import { discover, checksum } from "../packages/core/releases.js";
function zip(name, content) {
  const n = Buffer.from(name),
    body = Buffer.from(content),
    crc = crc32(body),
    local = Buffer.alloc(30),
    central = Buffer.alloc(46),
    end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(n.length, 26);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(n.length, 28);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + n.length, 12);
  end.writeUInt32LE(local.length + n.length + body.length, 16);
  return Buffer.concat([local, n, body, central, n, end]);
}
async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bdm-install-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const archive = zip("app/blender.exe", "binary fixture");
  const release = {
    id: "blender",
    name: "Blender",
    version: "1.2.3",
    platform: "win32",
    filename: "blender.zip",
    url: "https://example.com/blender.zip",
    sha256: createHash("sha256").update(archive).digest("hex"),
  };
  return { library: new Library(root), archive, release };
}
test("downloads, verifies, installs and records a release; duplicates rejected", async (t) => {
  const { library, archive, release } = await setup(t);
  const phases = [];
  const result = await install(release, library, {
    fetcher: async () => new Response(archive),
    onProgress: (p) => phases.push(p.phase),
  });
  assert.equal(await fs.readFile(result.executable, "utf8"), "binary fixture");
  assert.equal((await library.read()).installs.length, 1);
  assert.ok(phases.includes("Verifying"));
  assert.equal(phases.at(-1), "Installed");
  await assert.rejects(install(release, library), /already installed/);
});
test("checksum failure leaves no installation or staging files", async (t) => {
  const { library, archive, release } = await setup(t);
  await assert.rejects(
    install({ ...release, sha256: "0".repeat(64) }, library, {
      fetcher: async () => new Response(archive),
    }),
    /checksum/,
  );
  assert.deepEqual((await library.read()).installs, []);
  assert.deepEqual(
    await fs.readdir(path.join(library.root, "installations")),
    [],
  );
});
test("canceled operation leaves no install", async (t) => {
  const { library, release } = await setup(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    install(release, library, { signal: controller.signal }),
    /abort/i,
  );
  assert.deepEqual((await library.read()).installs, []);
});
test("archive traversal is rejected", () => {
  for (const name of ["../escape", "/tmp/escape", "C:/escape", "a\\..\\escape"])
    assert.throws(() => safePath(name), /Unsafe/);
});
test("Blender discovery chooses newest supported release and exact checksum", async () => {
  const hash = "a".repeat(64);
  const fetcher = async (url) =>
    new Response(
      url.endsWith("/release/")
        ? '<a href="Blender5.2/">'
        : url.endsWith("/Blender5.2/")
          ? '<a href="blender-5.2.2-windows-x64.zip">'
          : `${hash}  blender-5.2.2-windows-x64.zip`,
    );
  const result = await discover("blender", {
    platform: "win32",
    arch: "x64",
    fetcher,
  });
  assert.equal(result.version, "5.2.2");
  assert.equal(result.sha256, hash);
  assert.throws(() => checksum(`${hash} other.zip`, "wanted.zip"), /No SHA/);
});
test("Kitchen discovery excludes installers and labels pre-releases", async () => {
  const fetcher = async () =>
    Response.json([
      {
        draft: false,
        tag_name: "build-123",
        prerelease: true,
        assets: [
          { name: "Kitchen3D-windows-x64-setup.exe" },
          {
            name: "Kitchen3D-windows-x64.zip",
            digest: "sha256:" + "b".repeat(64),
            browser_download_url: "https://github.com/release.zip",
          },
        ],
      },
    ]);
  const result = await discover("kitchen3d", {
    platform: "win32",
    arch: "x64",
    fetcher,
  });
  assert.equal(result.channel, "Pre-release");
  assert.equal(result.filename, "Kitchen3D-windows-x64.zip");
  await assert.rejects(
    discover("kitchen3d", { platform: "darwin", arch: "x64", fetcher }),
    /No Kitchen/,
  );
});

test("transient download failure retries and succeeds", async (t) => {
  const { library, archive, release } = await setup(t);
  let attempts = 0;
  await install(release, library, {
    fetcher: async () =>
      ++attempts === 1
        ? new Response("", { status: 502 })
        : new Response(archive),
  });
  assert.equal(attempts, 2);
  assert.equal((await library.read()).installs.length, 1);
});
test("malicious ZIP never writes outside staging", async (t) => {
  const { library, release } = await setup(t);
  const archive = zip("../escape.exe", "bad");
  release.sha256 = createHash("sha256").update(archive).digest("hex");
  await assert.rejects(
    install(release, library, { fetcher: async () => new Response(archive) }),
    /invalid relative path|Unsafe/,
  );
  assert.deepEqual((await library.read()).installs, []);
  assert.deepEqual(
    await fs.readdir(path.join(library.root, "installations")),
    [],
  );
});
test("cancel during download cleans partial bytes", async (t) => {
  const { library, release } = await setup(t);
  const controller = new AbortController();
  await assert.rejects(
    install(release, library, {
      signal: controller.signal,
      fetcher: async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array([1, 2, 3]));
            },
          }),
        ),
      onProgress: (p) => {
        if (p.phase === "Downloading") controller.abort();
      },
    }),
    /abort/i,
  );
  assert.deepEqual(
    await fs.readdir(path.join(library.root, "installations")),
    [],
  );
});
