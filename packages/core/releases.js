const base = "https://download.blender.org/release/";
const versionSort = (a, b) => b.localeCompare(a, undefined, { numeric: true });
export function checksum(text, name) {
  const line = text.split(/\r?\n/).find(
    (l) =>
      l
        .trim()
        .split(/\s+\*?/)
        .at(-1) === name,
  );
  const hash = line?.match(/^[a-f0-9]{64}/i)?.[0];
  if (!hash) throw Error("No SHA-256 checksum published for this download.");
  return hash.toLowerCase();
}
export async function discover(
  id,
  { platform = process.platform, arch = process.arch, fetcher = fetch } = {},
) {
  if (id === "mixar") {
    const releases = await listReleases(id, {
      platform,
      arch,
      fetcher,
      channel: "All",
    });
    if (!releases.length)
      throw Error("No compatible Mixar archive is available.");
    return resolveRelease(releases[0], fetcher);
  }
  const os = { win32: "windows", darwin: "macos", linux: "linux" }[platform];
  if (!os) throw Error("Unsupported operating system.");
  const get = async (url) => {
    const r = await fetcher(url, {
      headers: {
        "User-Agent": "Blender-Distro-Manager",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok)
      throw Error(
        `Release lookup failed (HTTP ${r.status}). Try again shortly.`,
      );
    return r;
  };
  if (id === "blender") {
    const index = await (await get(base)).text();
    const dirs = [
      ...new Set(
        [...index.matchAll(/href="(Blender\d+\.\d+\/)"/g)].map((m) => m[1]),
      ),
    ].sort(versionSort);
    for (const dir of dirs.slice(0, 6)) {
      const html = await (await get(base + dir)).text();
      const ext =
        platform === "win32" ? "zip" : platform === "darwin" ? "dmg" : "tar.xz";
      const names = [...html.matchAll(/href="([^"]+)"/g)]
        .map((m) => m[1])
        .filter((n) =>
          new RegExp(
            `^blender-\\d+\\.\\d+\\.\\d+-${os}-${arch}\\.${ext.replaceAll(".", "\\.")}$`,
          ).test(n),
        )
        .sort(versionSort);
      if (!names.length) continue;
      const name = names[0];
      const version = name.match(/^blender-([\d.]+)-/)[1];
      const sums = await (
        await get(`${base}${dir}blender-${version}.sha256`)
      ).text();
      return {
        id,
        name: "Blender",
        version,
        channel: "Stable",
        filename: name,
        url: base + dir + name,
        sha256: checksum(sums, name),
        platform,
        arch,
      };
    }
    throw Error(`No Blender download is available for ${os} ${arch}.`);
  }
  if (id === "kitchen3d") {
    const releases = await (
      await get(
        "https://api.github.com/repos/BaerBonesTechnology/kitchen-3d/releases?per_page=20",
      )
    ).json();
    const filename = `Kitchen3D-${os}-${arch}.${platform === "linux" ? "tar.xz" : "zip"}`;
    for (const release of releases.filter((r) => !r.draft)) {
      const asset = release.assets.find((a) => a.name === filename);
      if (!asset) continue;
      let sha256 = asset.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1];
      if (!sha256) {
        const sums = release.assets.find(
          (a) => a.name === filename + ".sha256",
        );
        if (!sums) continue;
        sha256 = checksum(
          await (await get(sums.browser_download_url)).text(),
          filename,
        );
      }
      return {
        id,
        name: "Kitchen 3D",
        version: release.tag_name,
        channel: release.prerelease ? "Pre-release" : "Stable",
        filename,
        url: asset.browser_download_url,
        sha256,
        platform,
        arch,
      };
    }
    throw Error(`No Kitchen 3D download is available for ${os} ${arch}.`);
  }
  throw Error("Unknown distribution.");
}

export async function listReleases(
  id,
  {
    platform = process.platform,
    arch = process.arch,
    fetcher = fetch,
    channel = "Stable",
  } = {},
) {
  const os = { win32: "windows", darwin: "macos", linux: "linux" }[platform];
  if (!os) throw Error("Unsupported operating system.");
  const get = async (url) => {
    const r = await fetcher(url, {
      signal: AbortSignal.timeout(30000),
      headers: { "User-Agent": "Blender-Distro-Manager" },
    });
    if (!r.ok)
      throw Error(`Release lookup failed (HTTP ${r.status}). Try again.`);
    return r;
  };
  const ext =
    platform === "win32" ? "zip" : platform === "darwin" ? "dmg" : "tar.xz";
  if (id === "blender" && channel === "Stable") {
    const index = await (await get(base)).text();
    const dirs = [
      ...new Set(
        [...index.matchAll(/href="(Blender(\d+)\.\d+\/)"/g)]
          .filter((m) => Number(m[2]) >= 3)
          .map((m) => m[1]),
      ),
    ].sort(versionSort);
    const releases = [];
    let failures = 0;
    for (let start = 0; start < dirs.length; start += 4) {
      await Promise.all(
        dirs.slice(start, start + 4).map(async (dir) => {
          try {
            const html = await (await get(base + dir)).text();
            const aliases =
              arch === "x64" ? "(?:x64|x86_64|x86-64|amd64)" : arch;
            const names = [
              ...new Set(
                [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]),
              ),
            ].filter((n) =>
              new RegExp(
                `^blender-\\d+\\.\\d+\\.\\d+-${os}-${aliases}\\.${ext.replaceAll(".", "\\.")}$`,
              ).test(n),
            );
            for (const filename of names) {
              const version = filename.match(/^blender-([\d.]+)-/)[1];
              if (!html.includes(`blender-${version}.sha256`)) continue;
              releases.push({
                id,
                name: "Blender",
                version,
                channel,
                filename,
                url: base + dir + filename,
                checksumUrl: `${base}${dir}blender-${version}.sha256`,
                platform,
                arch,
              });
            }
          } catch {
            failures++;
          }
        }),
      );
    }
    if (failures)
      throw Error("Some release archives could not be loaded. Please retry.");
    return releases.sort((a, b) => versionSort(a.version, b.version));
  }
  if (id === "blender" && ["Beta", "Alpha"].includes(channel)) {
    const builds = await (
      await get("https://builder.blender.org/download/daily/?format=json&v=1")
    ).json();
    const matches = builds.filter(
      (b) =>
        b.release_cycle === channel.toLowerCase() &&
        b.platform === (platform === "darwin" ? "darwin" : os) &&
        [arch, arch === "x64" ? "x86_64" : arch].includes(b.architecture) &&
        b.file_extension === ext,
    );
    return matches
      .sort((a, b) => b.file_mtime - a.file_mtime)
      .filter(
        (b) => new URL(b.url).origin === "https://cdn.builder.blender.org",
      )
      .map((b) => ({
        id,
        name: "Blender",
        version: `${b.version} ${b.hash}`,
        channel,
        filename: b.file_name,
        url: b.url,
        checksumUrl: b.url + ".sha256",
        bareChecksum: true,
        platform,
        arch,
        date: new Date(b.file_mtime * 1000).toISOString().slice(0, 10),
      }));
  }
  if (id === "kitchen3d" || id === "mixar") {
    const repo =
      id === "mixar" ? "Mixar-AI/mixar-app" : "BaerBonesTechnology/kitchen-3d";
    const result = [];
    for (let page = 1; page <= 10; page++) {
      const releases = await (
        await get(
          `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`,
        )
      ).json();
      const kitchenFilename = `Kitchen3D-${os}-${arch}.${platform === "linux" ? "tar.xz" : "zip"}`;
      for (const r of releases.filter((r) => !r.draft)) {
        const label = /alpha/i.test(r.tag_name + " " + r.name)
          ? "Alpha"
          : /beta/i.test(r.tag_name + " " + r.name)
            ? "Beta"
            : r.prerelease
              ? "Pre-release"
              : "Stable";
        if (channel !== "All" && label !== channel) continue;
        const mixarSuffix =
          platform === "darwin" && arch === "arm64"
            ? "-arm64.dmg"
            : platform === "linux" && arch === "x64"
              ? "-linux-x86_64.tar.xz"
              : null;
        const asset = r.assets.find((a) =>
          id === "mixar"
            ? mixarSuffix &&
              /^Mixar-[0-9]/.test(a.name) &&
              a.name.endsWith(mixarSuffix)
            : a.name === kitchenFilename,
        );
        const filename = asset?.name;
        if (!asset) continue;
        const sha256 = asset.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1];
        const sums = r.assets.find((a) => a.name === filename + ".sha256");
        if (!sha256 && !sums) continue;
        result.push({
          id,
          name: id === "mixar" ? "Mixar" : "Kitchen 3D",
          version: r.tag_name,
          channel: label,
          filename,
          url: asset.browser_download_url,
          sha256,
          checksumUrl: sums?.browser_download_url,
          platform,
          arch,
          date: r.published_at?.slice(0, 10),
        });
      }
      if (releases.length < 100) break;
    }
    return result;
  }
  throw Error("Unknown distribution or release channel.");
}
export async function resolveRelease(release, fetcher = fetch) {
  if (release.sha256) return release;
  const response = await fetcher(release.checksumUrl, {
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw Error(
      `Checksum lookup failed (HTTP ${response.status}). Refresh the release list and try again.`,
    );
  const text = await response.text();
  const sha256 =
    release.bareChecksum && /^[a-f0-9]{64}\s*$/i.test(text)
      ? text.trim().toLowerCase()
      : checksum(text, release.filename);
  return { ...release, sha256 };
}
