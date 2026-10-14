const themeSelect = document.querySelector("#theme");
let theme = "system";
try {
  theme = localStorage.getItem("theme") || "system";
} catch {}
function applyTheme(value) {
  document.documentElement.dataset.theme = value;
  if (themeSelect) themeSelect.value = value;
}
applyTheme(["light", "dark", "system"].includes(theme) ? theme : "system");
themeSelect?.addEventListener("change", () => {
  applyTheme(themeSelect.value);
  try {
    localStorage.setItem("theme", themeSelect.value);
  } catch {}
});
