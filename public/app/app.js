/* Shared helpers for the Masar app pages: language, copy, toast, icons and small SVG charts. */
window.Masar = (function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  let lang = "ar";
  try { lang = localStorage.getItem("masar-lang") === "en" ? "en" : "ar"; } catch (e) {}
  let dict = { ar: {}, en: {} };
  const hooks = [];

  function t(k) { return (dict[lang] && dict[lang][k] !== undefined) ? dict[lang][k] : k; }
  function apply() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    $$("[data-t]").forEach((el) => { el.textContent = t(el.dataset.t); });
    $$("[data-ph]").forEach((el) => { el.setAttribute("placeholder", t(el.dataset.ph)); });
    $$("[data-al]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.al)); });
    hooks.forEach((f) => f(lang));
  }
  function init(d) {
    dict = d;
    $$("[data-lang-toggle]").forEach((b) => b.addEventListener("click", () => {
      lang = lang === "ar" ? "en" : "ar";
      try { localStorage.setItem("masar-lang", lang); } catch (e) {}
      apply();
    }));
    apply();
  }
  let toastTimer;
  function toast(msg) {
    let el = $(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }
  const fmt = (n) => new Intl.NumberFormat("en-US").format(n);

  const ICONS = {
    home: "M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
    target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
    plug: "M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5",
    toggle: "M7 6h10a6 6 0 0 1 0 12H7A6 6 0 0 1 7 6zM7 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    db: "M12 3c5 0 8 1.5 8 3.5S17 10 12 10 4 8.5 4 6.5 7 3 12 3zM4 6.5v11C4 19.5 7 21 12 21s8-1.5 8-3.5v-11M4 12c0 2 3 3.5 8 3.5s8-1.5 8-3.5",
    chat: "M4 5h16v11H9l-5 4z",
    users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14a7 7 0 0 1 4 7",
    eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
    card: "M3 6h18v12H3zM3 10h18M7 15h4",
    chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
    out: "M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3",
    search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5",
    down: "M12 4v12M6 10l6 6 6-6M4 20h16",
    up: "M12 20V8M6 14l6-6 6 6M4 4h16",
    plus: "M12 5v14M5 12h14",
    trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
    check: "M5 12l5 5 9-10"
  };
  const icon = (k) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + ICONS[k] + '"/></svg>';
  const mark = (size) => '<svg viewBox="0 0 96 96" width="' + size + '" height="' + size + '" aria-hidden="true"><rect width="96" height="96" rx="20" fill="#101A1B"/><rect x=".75" y=".75" width="94.5" height="94.5" rx="19.25" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="1.5"/><path d="M25 67V34c0-5 4-9 9-9h10c5 0 9 4 9 9v12c0 5 4 9 9 9h9" fill="none" stroke="#FAF8F3" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="74" cy="55" r="7" fill="#72B7A7"/></svg>';

  /* Bar chart: values, labels, optional goal line. Drawn in a 600x220 box. */
  function bars(el, vals, labels, opts = {}) {
    const W = 600, H = 220, pl = 34, pb = 26, pt = 10, max = Math.max(opts.goal || 0, ...vals) * 1.15 || 1;
    const bw = (W - pl) / vals.length, y = (v) => pt + (H - pt - pb) * (1 - v / max);
    const ticks = [0, 0.5, 1].map((f) => Math.round(max * f / 1.15));
    let s = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="' + (opts.label || "") + '">';
    ticks.forEach((v) => { s += '<line class="grid" x1="' + pl + '" x2="' + W + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="' + (pl - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + fmt(v) + "</text>"; });
    const rtl = document.documentElement.dir === "rtl";
    vals.forEach((v, i) => {
      const idx = rtl ? vals.length - 1 - i : i, x = pl + idx * bw + bw * 0.18, w = bw * 0.64;
      s += '<rect class="bar' + (i === vals.length - 1 ? " hi" : "") + '" x="' + x.toFixed(1) + '" y="' + y(v).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + (H - pb - y(v)).toFixed(1) + '" rx="3"><title>' + labels[i] + ": " + fmt(v) + "</title></rect>";
      s += '<text class="lbl" x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + labels[i] + "</text>";
    });
    if (opts.goal) s += '<line class="goal" x1="' + pl + '" x2="' + W + '" y1="' + y(opts.goal) + '" y2="' + y(opts.goal) + '"/>';
    el.innerHTML = s + "</svg>";
  }
  /* Line chart with one or two series */
  function lines(el, a, b, labels, opts = {}) {
    const W = 600, H = 220, pl = 40, pb = 26, pt = 10, max = Math.max(...a, ...(b || [0])) * 1.15 || 1;
    const rtl = document.documentElement.dir === "rtl";
    const x = (i) => { const f = i / (a.length - 1); return pl + (W - pl - 6) * (rtl ? 1 - f : f); }, y = (v) => pt + (H - pt - pb) * (1 - v / max);
    const path = (arr) => arr.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join("");
    let s = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="' + (opts.label || "") + '"><defs><linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#72b7a7" stop-opacity=".28"/><stop offset="1" stop-color="#72b7a7" stop-opacity="0"/></linearGradient></defs>';
    [0, 0.5, 1].forEach((f) => { const v = Math.round(max * f / 1.15); s += '<line class="grid" x1="' + pl + '" x2="' + W + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="' + (pl - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + fmt(v) + "</text>"; });
    s += '<path class="area" d="' + path(a) + "L" + x(a.length - 1).toFixed(1) + " " + (H - pb) + "L" + x(0).toFixed(1) + " " + (H - pb) + 'Z"/>';
    s += '<path class="line" d="' + path(a) + '"/>';
    if (b) s += '<path class="line2" d="' + path(b) + '"/>';
    labels.forEach((l, i) => { if (l) s += '<text class="lbl" x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + l + "</text>"; });
    s += '<circle cx="' + x(a.length - 1).toFixed(1) + '" cy="' + y(a[a.length - 1]).toFixed(1) + '" r="4" fill="#72b7a7"/>';
    el.innerHTML = s + "</svg>";
  }

  return { $, $$, t, init, apply, onLang: (f) => hooks.push(f), get lang() { return lang; }, store, toast, fmt, icon, mark, bars, lines };
})();
