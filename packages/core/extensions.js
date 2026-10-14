import fs from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parse } from "smol-toml";
import { unzip } from "./installer.js";
export const extensionAPI = "https://extensions.blender.org/api/v1/extensions/";
export function normalizeCatalog(json) {
  const blocked = new Set(
    (json.blocklist || []).map((b) => (typeof b === "string" ? b : b.id)),
  );
  return (json.data || [])
    .filter(
      (a) =>
        a.type === "add-on" &&
        !blocked.has(a.id) &&
        /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(a.id) &&
        /^sha256:[a-f0-9]{64}$/i.test(a.archive_hash),
    )
    .filter((a) => {
      try {
        return (
          new URL(a.archive_url, extensionAPI).origin ===
          "https://extensions.blender.org"
        );
      } catch {
        return false;
      }
    })
    .map((a) => ({
      ...a,
      key: a.id + ":" + a.archive_hash,
      archive_url: new URL(a.archive_url, extensionAPI).href,
    }));
}
export async function fetchCatalog(fetcher = fetch) {
  const r = await fetcher(extensionAPI, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok)
    throw Error(
      `Blender community catalog unavailable (HTTP ${r.status}). Try again.`,
    );
  return normalizeCatalog(await r.json());
}
const compare = (a, b) => {
  const x = a.split(".").map(Number),
    y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (x[i] || 0) - (y[i] || 0);
    if (diff) return diff;
  }
  return 0;
};
export function compatible(
  manifest,
  version,
  platform = process.platform,
  arch = process.arch,
) {
  if (!version || !/^\d+\.\d+\.\d+$/.test(version))
    return "Could not determine this build’s Blender version.";
  if (compare(version, "4.2.0") < 0)
    return "Extensions require Blender 4.2 or newer.";
  if (
    manifest.blender_version_min &&
    compare(version, manifest.blender_version_min) < 0
  )
    return `Requires Blender ${manifest.blender_version_min} or newer.`;
  if (
    manifest.blender_version_max &&
    compare(version, manifest.blender_version_max) >= 0
  )
    return `Requires Blender older than ${manifest.blender_version_max}.`;
  const target =
    { darwin: "macos", win32: "windows", linux: "linux" }[platform] +
    "-" +
    (arch === "x64" ? "x64" : arch);
  if (manifest.platforms?.length && !manifest.platforms.includes(target))
    return "This add-on does not support this platform.";
  if (manifest.wheels?.length)
    return "This add-on needs Python dependencies; shared wheel installation is not supported yet.";
  return null;
}
export async function installExtension(entry, library, fetcher = fetch) {
  if (!normalizeCatalog({ data: [entry] }).length)
    throw Error("Invalid community add-on.");
  if (
    (await library.read()).addons.some(
      (a) => a.archiveHash === entry.archive_hash,
    )
  )
    throw Error("This add-on version is already in your shared library.");
  const parent = path.join(library.root, "extensions");
  await fs.mkdir(parent, { recursive: true });
  const stage = await fs.mkdtemp(path.join(parent, ".staging-"));
  const payload = path.join(stage, "payload");
  await fs.mkdir(payload);
  const final = path.join(parent, randomUUID(), entry.id);
  let moved = false;
  try {
    const response = await fetcher(entry.archive_url, {
      signal: AbortSignal.timeout(180000),
    });
    if (!response.ok)
      throw Error(`Add-on download failed (HTTP ${response.status}).`);
    let bytes = 0;
    const hash = createHash("sha256");
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        bytes += chunk.length;
        if (bytes > 512 * 1024 ** 2)
          return cb(Error("Add-on download exceeds 512 MB."));
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    const archive = path.join(stage, "extension.zip");
    await pipeline(
      Readable.fromWeb(response.body),
      meter,
      createWriteStream(archive),
    );
    if ("sha256:" + hash.digest("hex") !== entry.archive_hash.toLowerCase())
      throw Error("Add-on checksum does not match.");
    await unzip(archive, payload);
    const inspect = async (dir) => {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        if (e.isSymbolicLink())
          throw Error("Extension packages cannot contain symbolic links.");
        if (e.isDirectory()) await inspect(path.join(dir, e.name));
      }
    };
    await inspect(payload);
    const manifest = parse(
      await fs.readFile(path.join(payload, "blender_manifest.toml"), "utf8"),
    );
    if (
      manifest.id !== entry.id ||
      manifest.version !== entry.version ||
      manifest.type !== "add-on"
    )
      throw Error("Extension manifest does not match the catalog.");
    await fs.access(path.join(payload, "__init__.py"));
    await fs.mkdir(path.dirname(final), { recursive: true });
    await fs.rename(payload, final);
    moved = true;
    const item = {
      id: randomUUID(),
      kind: "extension",
      module: entry.id,
      name: entry.name,
      version: manifest.version,
      path: final,
      manifest,
      archiveHash: entry.archive_hash,
    };
    await library.update((state) => {
      if (state.addons.some((a) => a.archiveHash === entry.archive_hash))
        throw Error("This add-on version is already installed.");
      state.addons.push(item);
    });
    moved = false;
    return item;
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
    if (moved)
      await fs.rm(path.dirname(final), { recursive: true, force: true });
  }
}
