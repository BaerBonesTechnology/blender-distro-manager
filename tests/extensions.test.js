import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCatalog,
  compatible,
  installExtension,
} from "../packages/core/extensions.js";
import { Library } from "../packages/core/library.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const entry = {
  id: "tools",
  type: "add-on",
  archive_hash: "sha256:" + "a".repeat(64),
  archive_url: "https://extensions.blender.org/tools.zip",
};
test("catalog excludes themes, blocked add-ons and third-party downloads", () => {
  assert.equal(
    normalizeCatalog({
      data: [
        entry,
        { ...entry, type: "theme" },
        { ...entry, archive_url: "https://example.org/a.zip" },
      ],
    }).length,
    1,
  );
  assert.equal(
    normalizeCatalog({ data: [entry], blocklist: [{ id: "tools" }] }).length,
    0,
  );
});
test("compatibility respects inclusive minimum, exclusive maximum and platform", () => {
  const manifest = {
    blender_version_min: "4.2.0",
    blender_version_max: "5.4.0",
    platforms: ["windows-x64"],
  };
  assert.equal(compatible(manifest, "4.2.0", "win32", "x64"), null);
  assert.match(compatible(manifest, "5.4.0", "win32", "x64"), /older/);
  assert.match(compatible(manifest, "4.1.0", "win32", "x64"), /4.2/);
  assert.match(compatible(manifest, "5.2.0", "darwin", "arm64"), /platform/);
  assert.match(
    compatible({ ...manifest, wheels: ["dep.whl"] }, "5.2.0", "win32", "x64"),
    /dependencies/,
  );
});
test("corrupt extension archive never enters the library", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bdm-extension-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const library = new Library(root);
  await assert.rejects(
    installExtension(entry, library, async () => new Response("invalid")),
    /checksum/,
  );
  assert.equal((await library.read()).addons.length, 0);
  assert.deepEqual(await fs.readdir(path.join(root, "extensions")), []);
});

test("LZMA community package installs intact and rejects mismatched manifest", async (t) => {
  const { createHash } = await import("node:crypto");
  const archive = await fs.readFile(
    new URL("./fixtures/extension-lzma.zip", import.meta.url),
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bdm-lzma-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const library = new Library(root);
  const fixture = {
    ...entry,
    id: "fixture_tools",
    name: "Fixture Tools",
    version: "1.0.0",
    archive_hash:
      "sha256:" + createHash("sha256").update(archive).digest("hex"),
  };
  await assert.rejects(
    installExtension(
      { ...fixture, version: "2.0.0" },
      library,
      async () => new Response(archive),
    ),
    /manifest/,
  );
  const item = await installExtension(
    fixture,
    library,
    async () => new Response(archive),
  );
  assert.equal(item.kind, "extension");
  assert.equal(
    await fs.readFile(path.join(item.path, "__init__.py"), "utf8"),
    "# UTF-8 fixture: café\n",
  );
  assert.deepEqual(
    await fs.readFile(path.join(item.path, "binary.dat")),
    Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
  );
  assert.equal((await library.read()).addons.length, 1);
});
