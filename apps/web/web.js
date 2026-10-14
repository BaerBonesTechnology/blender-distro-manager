const main = document.querySelector("#main");
const intro = (label, title, text) =>
  `<div class="eyebrow">${label}</div><h1>${title}</h1><p>${text}</p>`;
const catalogSection =
  '<section class="section"><div class="section-head"><h2>Find your next Blender.</h2><span class="small">Official + community</span></div><div id="catalog" class="grid"></div></section>';
const route = location.pathname;
if (route === "/submit") {
  main.innerHTML =
    intro(
      "Made something your own?",
      "Give your distro<br>a home.",
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
      "Your builds.<br>One place.",
      "The manager is in local preview. Packaged downloads will appear here after platform testing.",
    ) +
    `<div class="grid section">${["Windows", "macOS", "Linux"].map((os) => `<article class="card"><div class="tag">Planned</div><h2>${os}</h2><p>No public installer yet. This page will show release versions, checksums, and installation instructions when packages are available.</p></article>`).join("")}</div><p class="notice">Developers: run <code>npm install</code> and <code>npm start</code> in the project repository. Node.js 24 or newer required.</p>`;
} else if (route === "/distros") {
  main.innerHTML =
    intro(
      "The distribution directory",
      "Different workflows.<br>Same creative roots.",
      "Explore official Blender and community distributions. Links open the maintainer’s own website.",
    ) + catalogSection;
} else {
  main.innerHTML =
    `<section class="hero"><div>${intro("One library. More possibilities.", 'Your Blender.<br><span class="accent">Your way.</span>', "Keep your favorite Blender builds together. Share your add-ons, give every build its own settings, and spend more time making things.")}<div class="actions"><a class="button" href="/downloads">Get the manager ↗</a><a class="button secondary" href="/distros">Explore distributions</a></div><p class="small">Local preview · Windows, macOS & Linux planned</p></div><div class="mock" aria-label="Illustration of the planned manager"><div class="mock-title"><span>◈ YOUR CREATIVE TOOLBOX</span><span>Concept preview</span></div><div class="mock-body"><h3>Ready when you are.</h3><div class="mock-row"><span class="tile">◉</span><div>Blender<small>Your everyday workspace</small></div><span class="pill">OFFICIAL</span></div><div class="mock-row"><span class="tile">▣</span><div>Kitchen 3D<small>A workflow of your own</small></div><span class="pill">COMMUNITY</span></div><p class="small">↳ Shared add-ons. Independent settings.</p></div></div></section><section class="section grid"><article><span class="number">01 / MANAGE</span><h3>A place for every build.</h3><p>Keep versions side by side and launch the right one for each project.</p></article><article><span class="number">02 / SHARE</span><h3>Your tools travel with you.</h3><p>One add-on library, with explicit assignments to the builds you use.</p></article><article><span class="number">03 / DISCOVER</span><h3>Make room for something new.</h3><p>Explore community distributions or submit the one you’ve been building.</p></article></section>` +
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
