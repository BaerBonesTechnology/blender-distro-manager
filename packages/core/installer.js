import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import yauzl from "yauzl";
import * as tar from "tar";
const exec = promisify(execFile);
export function safePath(name) {
  if (
    !name ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.startsWith("/") ||
    /^[a-z]:/i.test(name) ||
    name.split("/").includes("..")
  )
    throw Error("Unsafe archive path.");
  return name;
}
export async function unzip(file, dest) {
  const zip = await new Promise((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true }, (e, z) =>
      e ? reject(e) : resolve(z),
    ),
  );
  const links = [];
  let bytes = 0;
  await new Promise((resolve, reject) => {
    const fail = (e) => {
      zip.close();
      reject(e);
    };
    zip.on("error", fail);
    zip.on("end", resolve);
    zip.on("entry", (entry) => {
      (async () => {
        const name = safePath(entry.fileName);
        const target = path.join(dest, name);
        bytes += entry.uncompressedSize;
        if (bytes > 16 * 1024 ** 3)
          throw Error("Archive exceeds the installation size limit.");
        const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
        const type = mode & 0xf000;
        if (name.endsWith("/")) {
          await fs.mkdir(target, { recursive: true });
          return;
        }
        const stream = await new Promise((resolve, reject) =>
          zip.openReadStream(entry, (e, s) => (e ? reject(e) : resolve(s))),
        );
        if (type === 0xa000) {
          let value = "";
          for await (const chunk of stream) {
            value += chunk;
            if (value.length > 4096) throw Error("Invalid archive link.");
          }
          const resolved = path.resolve(path.dirname(target), value);
          if (path.isAbsolute(value) || !resolved.startsWith(dest + path.sep))
            throw Error("Unsafe archive link.");
          links.push({ target, value });
          return;
        }
        if (type && type !== 0x8000) throw Error("Unsupported archive entry.");
        await fs.mkdir(path.dirname(target), { recursive: true });
        await pipeline(
          stream,
          createWriteStream(target, {
            flags: "wx",
            mode: mode & 0o777 || 0o644,
          }),
        );
      })().then(() => zip.readEntry(), fail);
    });
    zip.readEntry();
  });
  // Create links last so archive entries cannot write through them.
  for (const { target, value } of links) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.symlink(value, target);
  }
}
async function untar(file, dest) {
  const child = spawn("xz", ["-dc", file], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const finished = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            Error("Could not decompress archive. Install xz and try again."),
          ),
    );
  });
  let failure;
  let bytes = 0;
  const extractor = tar.x({
    cwd: dest,
    strict: true,
    preservePaths: false,
    filter: (name, entry) => {
      try {
        safePath(name);
        bytes += entry.size || 0;
        if (bytes > 16 * 1024 ** 3)
          throw Error("Archive exceeds installation size limit.");
        if (entry.type === "SymbolicLink" || entry.type === "Link") {
          const target =
            entry.type === "Link"
              ? path.resolve(dest, entry.linkpath)
              : path.resolve(dest, path.dirname(name), entry.linkpath);
          if (
            path.isAbsolute(entry.linkpath) ||
            !target.startsWith(dest + path.sep)
          )
            throw Error("Unsafe archive link.");
        }
        if (
          !["File", "Directory", "SymbolicLink", "Link", "OldFile"].includes(
            entry.type,
          )
        )
          throw Error("Unsupported archive entry.");
        return true;
      } catch (e) {
        failure = e;
        return false;
      }
    },
  });
  child.stderr.resume();
  await Promise.all([pipeline(child.stdout, extractor), finished]);
  if (failure) throw failure;
}
async function dmg(file, dest) {
  const mount = await fs.mkdtemp(path.join(path.dirname(dest), "mount-"));
  let mounted = false;
  try {
    await exec("hdiutil", [
      "attach",
      "-readonly",
      "-nobrowse",
      "-mountpoint",
      mount,
      file,
    ]);
    mounted = true;
    const apps = (await fs.readdir(mount)).filter((n) => n.endsWith(".app"));
    if (apps.length !== 1)
      throw Error("Expected one Blender application in disk image.");
    await exec("ditto", [path.join(mount, apps[0]), path.join(dest, apps[0])]);
  } finally {
    if (mounted) await exec("hdiutil", ["detach", mount]);
    await fs.rm(mount, { recursive: true, force: true });
  }
}
export async function findExecutable(root, platform) {
  const names =
    platform === "win32"
      ? ["kitchen3d.exe", "blender.exe"]
      : ["Kitchen 3D", "kitchen3d", "blender", "Blender"];
  const walk = async (dir, depth) => {
    if (depth > 7) return null;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const name of names) {
      const e = entries.find((e) => e.isFile() && e.name === name);
      if (
        e &&
        (platform !== "darwin" || dir.endsWith(path.join("Contents", "MacOS")))
      )
        return path.join(dir, e.name);
    }
    for (const e of entries.filter((e) => e.isDirectory())) {
      const found = await walk(path.join(dir, e.name), depth + 1);
      if (found) return found;
    }
    return null;
  };
  const found = await walk(root, 0);
  if (!found)
    throw Error("The archive does not contain a supported Blender executable.");
  return found;
}
export async function install(
  release,
  library,
  { signal, onProgress = () => {}, fetcher = fetch } = {},
) {
  if (!/^[a-f0-9]{64}$/i.test(release.sha256))
    throw Error("Missing SHA-256 checksum.");
  const current = await library.read();
  if (current.installs.some((i) => i.releaseKey === release.url))
    throw Error("This release is already installed.");
  const parent = path.join(library.root, "installations");
  await fs.mkdir(parent, { recursive: true });
  const stage = await fs.mkdtemp(path.join(parent, ".staging-"));
  const archive = path.join(stage, "download");
  const payload = path.join(stage, "payload");
  const final = path.join(parent, randomUUID());
  let moved = false;
  try {
    await fs.mkdir(payload);
    let downloaded = false;
    for (let attempt = 0; attempt < 3 && !downloaded; attempt++) {
      signal?.throwIfAborted();
      try {
        const response = await fetcher(release.url, {
          signal: AbortSignal.any([
            signal || new AbortController().signal,
            AbortSignal.timeout(30 * 60 * 1000),
          ]),
        });
        if (!response.ok)
          throw Error(`Download failed (HTTP ${response.status}).`);
        const total = Number(response.headers.get("content-length")) || 0;
        const disk = await fs.statfs(stage);
        if (total && disk.bavail * disk.bsize < total * 5 + 512 * 1024 ** 2)
          throw Error("Not enough free disk space to install this release.");
        let received = 0;
        const hash = createHash("sha256");
        const meter = new Transform({
          transform(chunk, encoding, callback) {
            received += chunk.length;
            hash.update(chunk);
            onProgress({
              phase: "Downloading",
              received,
              total,
              attempt: attempt + 1,
            });
            callback(null, chunk);
          },
        });
        await pipeline(
          Readable.fromWeb(response.body),
          meter,
          createWriteStream(archive),
          { signal },
        );
        onProgress({ phase: "Verifying" });
        if (hash.digest("hex") !== release.sha256.toLowerCase())
          throw Error("Download checksum does not match.");
        downloaded = true;
      } catch (e) {
        signal?.throwIfAborted();
        if (attempt === 2) throw e;
        onProgress({ phase: "Retrying download" });
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    signal?.throwIfAborted();
    onProgress({ phase: "Installing" });
    if (release.filename.endsWith(".zip")) await unzip(archive, payload);
    else if (release.filename.endsWith(".tar.xz"))
      await untar(archive, payload);
    else if (release.filename.endsWith(".dmg") && process.platform === "darwin")
      await dmg(archive, payload);
    else throw Error("Unsupported package format.");
    signal?.throwIfAborted();
    const executable = await findExecutable(payload, release.platform);
    if (release.platform !== "win32") await fs.chmod(executable, 0o755);
    await fs.rename(payload, final);
    moved = true;
    const item = {
      id: randomUUID(),
      name: `${release.name} ${release.version}`,
      executable: path.join(final, path.relative(payload, executable)),
      releaseKey: release.url,
      version: release.version,
      distro: release.id,
      managed: true,
    };
    await library.update((state) => {
      if (state.installs.some((i) => i.releaseKey === release.url))
        throw Error("This release is already installed.");
      state.installs.push(item);
    });
    moved = false;
    onProgress({ phase: "Installed" });
    return item;
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
    if (moved) await fs.rm(final, { recursive: true, force: true });
  }
}
