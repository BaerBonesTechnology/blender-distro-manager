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
