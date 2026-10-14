const main = document.querySelector("#main");
const intro = (label, title, text) =>
  `<div class="eyebrow">${label}</div><h1>${title}</h1><p>${text}</p>`;
const catalogSection =
  '<section class="section"><div class="section-head"><h2>Distributions</h2><span class="small">Official + community</span></div><div id="catalog" class="grid"></div></section>';
const route = location.pathname;
if (route === "/submit") {
  main.innerHTML =
    intro(
      "Made something your own?",
      "Submit a distribution",
      "Share your Blender distribution with the community. Every submission enters a review queue before publication.",
    ) +
    `<form id="submit"><label>Distribution name<input name="name" required maxlength="80"></label><label>What makes it different?<textarea name="description" required maxlength="1200"></textarea></label><label>Project or release page (HTTPS)<input name="url" type="url" required maxlength="500"></label><label>Maintainer contact (kept private)<input name="contact" required maxlength="200"></label><p class="small">Submit a project you maintain or are authorized to represent. Binary uploads and automatic publication are not supported in this prototype.</p><button>Submit for review →</button><div class="status" role="status"></div></form>`;
  document.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const button = e.target.querySelector("button");
    button.disabled = true;
    try {
      const r = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      e.target.reset();
      document.querySelector(".status").textContent =
        `Submission #${data.id} received. Pending review.`;
    } catch (error) {
      document.querySelector(".status").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
} else if (route === "/downloads") {
  main.innerHTML =
    intro(
      "Early development",
      "Download manager",
      "The manager is in local preview. Packaged downloads will appear here after platform testing.",
    ) +
    `<div class="grid section">${["Windows", "macOS", "Linux"].map((os) => `<article class="card"><div class="tag">Planned</div><h2>${os}</h2><p>No public installer yet. This page will show release versions, checksums, and installation instructions when packages are available.</p></article>`).join("")}</div><p class="notice">Developers: run <code>npm install</code> and <code>npm start</code> in the project repository. Node.js 24 or newer required.</p>`;
} else if (route === "/distros") {
  main.innerHTML =
    intro(
      "The distribution directory",
      "Distributions",
      "Explore official Blender and community distributions. Links open the maintainer’s own website.",
    ) + catalogSection;
} else {
  main.innerHTML =
    `<section class="hero"><h1>Blender Distro Manager</h1><p>Manage Blender installations and shared add-ons in one place.</p><div class="actions"><a class="button" href="/downloads">Download manager</a><a class="button secondary" href="/distros">Browse distributions</a></div><p class="small">Local preview. Packaged downloads are not available yet.</p></section>` +
    catalogSection;
}
if (document.querySelector("#catalog")) {
  try {
    const r = await fetch("/api/catalog");
    if (!r.ok) throw Error();
    const items = await r.json();
    for (const item of items) {
      const card = document.createElement("article");
      card.className = "card";
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = item.category;
      const title = document.createElement("h3");
      title.textContent = item.name;
      const desc = document.createElement("p");
      desc.textContent = item.description;
      const link = document.createElement("a");
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Visit project ↗";
      card.append(tag, title, desc, link);
      document.querySelector("#catalog").append(card);
    }
  } catch {
    document.querySelector("#catalog").textContent =
      "The directory could not be loaded. Please try again.";
  }
}
