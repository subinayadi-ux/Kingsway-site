// Highlights the "On this page" links on long pages as you scroll
(() => {
  const links = [...document.querySelectorAll(".toc a")];
  if (!links.length || !("IntersectionObserver" in window)) return;
  const byId = new Map(links.map(a => [a.getAttribute("href").slice(1), a]));
  const visible = new Set();
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id));
    const first = [...byId.keys()].find(id => visible.has(id));
    if (!first) return;
    links.forEach(a => a.classList.toggle("active", a === byId.get(first)));
    const active = byId.get(first);
    if (active && active.parentElement.scrollWidth > active.parentElement.clientWidth) {
      active.parentElement.scrollTo({ left: active.offsetLeft - 16, behavior: "smooth" });
    }
  }, { rootMargin: "-30% 0px -60% 0px" });
  byId.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
})();
