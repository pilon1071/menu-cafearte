import type { CloverItem, CloverCategory, CloverModifierGroup } from "./clover";

interface MenuSection {
  category: string;
  items: CloverItem[];
}

const EXCLUDED_CATEGORIES = ["regalos", "regalo"];

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Escapes HTML but wraps URLs in clickable anchor tags
function linkifyAndEscape(text: string): string {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        const escaped = escapeHtml(part);
        return `<a href="${escaped}" target="_blank" rel="noopener noreferrer" class="desc-link">${escaped}</a>`;
      }
      return escapeHtml(part);
    })
    .join("");
}

function groupItemsByCategory(
  items: CloverItem[],
  categories: CloverCategory[]
): MenuSection[] {
  const categoryOrder = new Map(
    categories.map((c, i) => [c.id, { name: c.name, order: c.sortOrder ?? i }])
  );

  const sections = new Map<string, MenuSection>();
  const uncategorized: CloverItem[] = [];

  for (const item of items) {
    const itemCategories = item.categories?.elements ?? [];

    // Filter out excluded categories
    const activeCategories = itemCategories.filter((cat) => {
      const name = (categoryOrder.get(cat.id)?.name ?? cat.name)
        .toLowerCase()
        .trim();
      return !EXCLUDED_CATEGORIES.some((ex) => name.includes(ex));
    });

    // Skip items that only belong to excluded categories
    if (itemCategories.length > 0 && activeCategories.length === 0) continue;

    if (activeCategories.length === 0) {
      uncategorized.push(item);
      continue;
    }

    const cat = activeCategories[0];
    const catInfo = categoryOrder.get(cat.id);
    const catName = catInfo?.name ?? cat.name;

    if (!sections.has(cat.id)) {
      sections.set(cat.id, { category: catName, items: [] });
    }
    sections.get(cat.id)!.items.push(item);
  }

  const sorted = [...sections.entries()]
    .sort(([aId], [bId]) => {
      const aOrder = categoryOrder.get(aId)?.order ?? 9999;
      const bOrder = categoryOrder.get(bId)?.order ?? 9999;
      return aOrder - bOrder;
    })
    .map(([, section]) => section);

  if (uncategorized.length > 0) {
    sorted.push({ category: "Otros", items: uncategorized });
  }

  return sorted;
}

function renderItem(
  item: CloverItem,
  translations: Record<string, string>
): string {
  const priceHtml =
    item.priceType === "VARIABLE"
      ? `<span class="price">Precio variable</span>`
      : `<span class="price">${formatPrice(item.price)}</span>`;

  const descEs = item.description ?? "";
  const descEn = translations[item.id] ?? descEs;

  const descHtml =
    descEs
      ? `<p class="description text-es">${linkifyAndEscape(descEs)}</p>` +
        `<p class="description text-en">${linkifyAndEscape(descEn)}</p>`
      : "";

  const imageUrl = item.imageUrl ?? item.images?.elements?.[0]?.url;
  const imageHtml = imageUrl
    ? `<img class="item-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.name)}" loading="lazy" />`
    : "";

  const hasModifiers = (item.modifierGroups?.elements?.length ?? 0) > 0;
  const modifierHintEs = hasModifiers ? `<span class="modifier-hint text-es">Toca para personalizar</span>` : "";
  const modifierHintEn = hasModifiers ? `<span class="modifier-hint text-en">Tap to customize</span>` : "";

  return `
    <div class="menu-item${hasModifiers ? " has-modifiers" : ""}" data-item-id="${escapeHtml(item.id)}">
      ${imageHtml}
      <div class="item-info">
        <div class="item-header">
          <h3 class="item-name">${escapeHtml(item.name)}</h3>
          ${priceHtml}
        </div>
        ${descHtml}
        ${modifierHintEs}${modifierHintEn}
      </div>
    </div>`;
}

function renderSection(
  section: MenuSection,
  translations: Record<string, string>
): string {
  const itemsHtml = section.items.map((item) => renderItem(item, translations)).join("");
  const anchorId = section.category.toLowerCase().replace(/\s+/g, "-");
  return `
    <section class="menu-section" id="cat-${anchorId}">
      <h2 class="category-title">${escapeHtml(section.category)}</h2>
      <div class="items-grid">
        ${itemsHtml}
      </div>
    </section>`;
}

function buildMenuData(
  items: CloverItem[],
  modifierGroupsMap: Map<string, CloverModifierGroup>,
  translations: Record<string, string>
): string {
  const data: Record<string, unknown> = {};
  for (const item of items) {
    const imageUrl = item.imageUrl ?? item.images?.elements?.[0]?.url ?? "";
    const groups = (item.modifierGroups?.elements ?? [])
      .map((ref) => modifierGroupsMap.get(ref.id))
      .filter((g): g is CloverModifierGroup => !!g)
      .map((g) => ({
        id: g.id,
        name: g.name,
        minRequired: g.minRequired ?? 0,
        maxAllowed: g.maxAllowed ?? 0,
        modifiers: (g.modifiers?.elements ?? [])
          .filter((m) => m.available !== false)
          .map((m) => ({ id: m.id, name: m.name, price: m.price ?? 0 })),
      }))
      .filter((g) => g.modifiers.length > 0);

    data[item.id] = {
      name: item.name,
      price: item.price ?? 0,
      priceType: item.priceType ?? "FIXED",
      description_es: item.description ?? "",
      description_en: translations[item.id] ?? item.description ?? "",
      imageUrl,
      modifierGroups: groups,
    };
  }
  return JSON.stringify(data);
}

export function generateMenuHTML(
  restaurantName: string,
  items: CloverItem[],
  categories: CloverCategory[],
  modifierGroupsMap: Map<string, CloverModifierGroup>,
  translations: Record<string, string>,
  generatedAt: Date
): string {
  const sections = groupItemsByCategory(items, categories);
  const sectionsHtml = sections
    .map((s) => renderSection(s, translations))
    .join("");
  const menuDataJson = buildMenuData(items, modifierGroupsMap, translations);
  const timestamp = generatedAt.toLocaleString("es-MX", {
    dateStyle: "long",
    timeStyle: "short",
  });

  return `<!DOCTYPE html>
<html lang="es" data-lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(restaurantName)} — Menú</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0F2A1F;
      --surface: #0d2319;
      --surface2: #122d20;
      --border: rgba(201,169,97,.18);
      --gold: #C9A961;
      --gold-hover: #d9ba73;
      --cream: #F4EBDD;
      --cream-muted: rgba(244,235,221,.65);
      --bean: #0A1A12;
      --display: 'Instrument Serif', 'Times New Roman', serif;
      --ui: 'Manrope', system-ui, -apple-system, sans-serif;
      --radius: 10px;
    }

    body {
      background: var(--bg);
      color: var(--cream);
      font-family: var(--ui);
      font-weight: 400;
      -webkit-font-smoothing: antialiased;
      min-height: 100vh;
    }

    ::selection { background: var(--gold); color: var(--bean); }

    /* Language switching */
    [data-lang="es"] .text-en { display: none; }
    [data-lang="en"] .text-es { display: none; }

    /* ── HEADER ── */
    header {
      background: var(--bean);
      border-bottom: 1px solid var(--border);
      padding: 2.5rem 1rem 2rem;
      text-align: center;
      position: relative;
    }

    .header-logo-link {
      display: inline-block;
      margin-bottom: 1.2rem;
      transition: transform .3s, opacity .3s;
    }

    .header-logo-link:hover { transform: scale(1.06); opacity: .88; }

    .header-logo {
      width: 110px;
      height: 110px;
      object-fit: contain;
      display: block;
      filter: drop-shadow(0 4px 18px rgba(0,0,0,.5));
    }

    .header-eyebrow {
      font-size: 11px;
      font-weight: 500;
      letter-spacing: .28em;
      text-transform: uppercase;
      color: var(--gold);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      margin-bottom: 0.5rem;
    }

    .header-eyebrow::before,
    .header-eyebrow::after {
      content: '';
      width: 28px;
      height: 1px;
      background: var(--gold);
      opacity: .6;
    }

    header h1 {
      font-family: var(--display);
      font-style: italic;
      font-weight: 400;
      font-size: clamp(2.2rem, 6vw, 4rem);
      color: var(--cream);
      letter-spacing: -0.01em;
      line-height: 1.1;
    }

    /* ── LANGUAGE SWITCHER ── */
    .lang-switch {
      position: absolute;
      top: 1.1rem;
      right: 1.1rem;
      display: flex;
      align-items: center;
      gap: 0;
      background: rgba(201,169,97,.1);
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
    }

    .lang-btn {
      background: none;
      border: none;
      color: var(--cream-muted);
      font-family: var(--ui);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .1em;
      padding: 0.4rem 0.65rem;
      cursor: pointer;
      transition: background .18s, color .18s;
    }

    .lang-btn.active {
      background: var(--gold);
      color: var(--bean);
    }

    .lang-btn:not(.active):hover { color: var(--gold); }

    .lang-divider {
      width: 1px;
      height: 18px;
      background: var(--border);
    }

    /* ── NAV TABS ── */
    .category-nav {
      position: sticky;
      top: 0;
      z-index: 10;
      background: rgba(10,26,18,.92);
      border-bottom: 1px solid var(--border);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      overflow-x: auto;
      scrollbar-width: none;
    }
    .category-nav::-webkit-scrollbar { display: none; }

    .category-nav__list {
      display: flex;
      list-style: none;
      padding: 0 1rem;
      gap: 0;
      min-width: max-content;
    }

    .category-nav__list a {
      display: block;
      padding: 0.85rem 1.1rem;
      color: var(--cream-muted);
      text-decoration: none;
      font-size: 11.5px;
      font-weight: 600;
      letter-spacing: .12em;
      text-transform: uppercase;
      white-space: nowrap;
      border-bottom: 2px solid transparent;
      transition: color .2s, border-color .2s;
    }

    .category-nav__list a:hover {
      color: var(--gold);
      border-bottom-color: var(--gold);
    }

    /* ── MAIN ── */
    main {
      max-width: 980px;
      margin: 0 auto;
      padding: 2.5rem 1rem 5rem;
    }

    /* ── SECTION ── */
    .menu-section { margin-bottom: 3.5rem; }

    .category-title {
      font-family: var(--display);
      font-style: italic;
      font-weight: 400;
      font-size: clamp(1.6rem, 3.5vw, 2.2rem);
      color: var(--cream);
      margin-bottom: 1.25rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .category-title::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--gold);
      opacity: .25;
    }

    /* ── GRID ── */
    .items-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 0.65rem;
    }

    @media (min-width: 600px) {
      .items-grid { grid-template-columns: repeat(2, 1fr); gap: 0.85rem; }
    }

    @media (min-width: 880px) {
      .items-grid { grid-template-columns: repeat(3, 1fr); }
    }

    /* ── ITEM CARD ── */
    .menu-item {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem 1.15rem;
      display: flex;
      gap: 0;
      align-items: flex-start;
      transition: border-color .25s, transform .25s, gap .25s;
    }

    .menu-item.has-modifiers { cursor: pointer; }

    .menu-item:hover {
      border-color: rgba(201,169,97,.5);
      transform: translateY(-2px);
      gap: 0.9rem;
    }

    .item-image {
      width: 72px;
      height: 72px;
      object-fit: cover;
      border-radius: 7px;
      flex-shrink: 0;
      max-width: 0;
      opacity: 0;
      overflow: hidden;
      transition: max-width .3s ease, opacity .3s ease;
    }

    .menu-item:hover .item-image {
      max-width: 72px;
      opacity: 1;
    }

    .item-info { flex: 1; min-width: 0; }

    .item-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 0.6rem;
    }

    .item-name {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--cream);
      line-height: 1.3;
    }

    .price {
      font-size: 0.9rem;
      font-weight: 700;
      color: var(--gold);
      white-space: nowrap;
      flex-shrink: 0;
    }

    .description {
      max-height: 0;
      overflow: hidden;
      opacity: 0;
      margin-top: 0;
      color: var(--cream-muted);
      font-size: 0.8rem;
      line-height: 1.5;
      transition: max-height .3s ease, opacity .3s ease, margin-top .3s ease;
    }

    .menu-item:hover .description {
      max-height: 120px;
      opacity: 1;
      margin-top: 0.3rem;
    }

    .desc-link {
      color: var(--gold);
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .desc-link:hover { color: var(--gold-hover); }

    .modifier-hint {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 0.45rem;
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: .1em;
      text-transform: uppercase;
      color: var(--gold);
      opacity: 0;
      transition: opacity .25s;
    }

    .modifier-hint::before { content: '✦'; font-size: 0.55rem; }

    .menu-item:hover .modifier-hint { opacity: 1; }

    /* ── FOOTER ── */
    footer {
      text-align: center;
      color: var(--cream-muted);
      font-size: 0.72rem;
      letter-spacing: .08em;
      padding: 2rem 1rem;
      border-top: 1px solid var(--border);
    }

    /* ── MODAL ── */
    #modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(10,26,18,.82);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      z-index: 200;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }

    #modal-overlay.open { display: flex; }

    #modal {
      background: #0e2518;
      border: 1px solid rgba(201,169,97,.28);
      border-radius: 16px;
      width: 100%;
      max-width: 460px;
      max-height: 88vh;
      overflow-y: auto;
      position: relative;
      display: flex;
      flex-direction: column;
    }

    #modal::-webkit-scrollbar { width: 4px; }
    #modal::-webkit-scrollbar-track { background: transparent; }
    #modal::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

    #modal-image-wrap { flex-shrink: 0; overflow: hidden; border-radius: 15px 15px 0 0; }
    #modal-image { width: 100%; height: 200px; object-fit: cover; display: block; }

    #modal-header {
      padding: 1.4rem 1.4rem 1rem;
      position: sticky;
      top: 0;
      background: #0e2518;
      z-index: 1;
      border-bottom: 1px solid var(--border);
    }

    .modal-close {
      position: absolute;
      top: 1rem;
      right: 1rem;
      background: rgba(201,169,97,.12);
      border: 1px solid var(--border);
      border-radius: 50%;
      width: 30px;
      height: 30px;
      color: var(--cream-muted);
      cursor: pointer;
      font-size: 1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color .2s, background .2s;
    }

    .modal-close:hover { color: var(--cream); background: rgba(201,169,97,.22); }

    #modal-name {
      font-family: var(--display);
      font-style: italic;
      font-size: 1.55rem;
      color: var(--cream);
      line-height: 1.15;
      padding-right: 2rem;
    }

    #modal-base-price {
      font-size: 1rem;
      font-weight: 700;
      color: var(--gold);
      margin-top: 0.3rem;
    }

    #modal-description {
      font-size: 0.82rem;
      color: var(--cream-muted);
      line-height: 1.55;
      margin-top: 0.4rem;
    }

    #modal-description a {
      color: var(--gold);
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    #modal-body { padding: 1.2rem 1.4rem; flex: 1; }

    .modifier-group { margin-bottom: 1.4rem; }

    .modifier-group-name {
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: .2em;
      text-transform: uppercase;
      color: var(--gold);
      margin-bottom: 0.55rem;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .req-badge {
      font-size: 0.6rem;
      font-weight: 600;
      letter-spacing: .06em;
      background: rgba(201,169,97,.15);
      border: 1px solid rgba(201,169,97,.3);
      border-radius: 4px;
      padding: 1px 5px;
      color: var(--gold);
      text-transform: uppercase;
    }

    .modifier-options { display: flex; flex-direction: column; gap: 0.4rem; }

    .modifier-btn {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.7rem 1rem;
      background: rgba(255,255,255,.03);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--cream);
      font-family: var(--ui);
      font-size: 0.875rem;
      cursor: pointer;
      transition: border-color .18s, background .18s;
      text-align: left;
      width: 100%;
      gap: 0.75rem;
    }

    .modifier-btn:hover { border-color: rgba(201,169,97,.45); background: rgba(201,169,97,.06); }
    .modifier-btn.selected { border-color: var(--gold); background: rgba(201,169,97,.13); }
    .modifier-btn .mod-name { flex: 1; }

    .mod-check {
      width: 18px;
      height: 18px;
      border: 1.5px solid var(--border);
      border-radius: 50%;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.65rem;
      color: transparent;
      transition: border-color .18s, background .18s;
    }

    .modifier-btn.selected .mod-check {
      border-color: var(--gold);
      background: var(--gold);
      color: var(--bean);
    }

    .modifier-price {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--cream-muted);
      white-space: nowrap;
      flex-shrink: 0;
    }

    .modifier-btn.selected .modifier-price { color: var(--gold); }

    #modal-footer {
      padding: 1rem 1.4rem 1.4rem;
      border-top: 1px solid var(--border);
      position: sticky;
      bottom: 0;
      background: #0e2518;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .total-block { display: flex; flex-direction: column; }

    .total-label {
      font-size: 0.65rem;
      font-weight: 600;
      letter-spacing: .18em;
      text-transform: uppercase;
      color: var(--cream-muted);
    }

    #modal-total {
      font-family: var(--display);
      font-style: italic;
      font-size: 2rem;
      color: var(--gold);
      line-height: 1;
    }

    .btn-close-modal {
      padding: 0.7rem 1.4rem;
      background: var(--gold);
      color: var(--bean);
      border: none;
      border-radius: 8px;
      font-family: var(--ui);
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: .1em;
      text-transform: uppercase;
      cursor: pointer;
      transition: background .2s, transform .2s;
    }

    .btn-close-modal:hover { background: var(--gold-hover); transform: translateY(-1px); }
  </style>
</head>
<body>
  <header>
    <div class="lang-switch">
      <button class="lang-btn active" data-lang="es" onclick="setLang('es')">ES</button>
      <div class="lang-divider"></div>
      <button class="lang-btn" data-lang="en" onclick="setLang('en')">EN</button>
    </div>
    <a href="https://cafearte.net" target="_blank" rel="noopener noreferrer" class="header-logo-link">
      <img class="header-logo" src="logo.png" alt="${escapeHtml(restaurantName)}" />
    </a>
    <div class="header-eyebrow">
      <span class="text-es">Menú</span>
      <span class="text-en">Menu</span>
    </div>
    <h1>${escapeHtml(restaurantName)}</h1>
  </header>
  <nav class="category-nav" aria-label="Categorías">
    <ul class="category-nav__list">
      ${sections.map((s) => `<li><a href="#cat-${s.category.toLowerCase().replace(/\s+/g, "-")}">${escapeHtml(s.category)}</a></li>`).join("")}
    </ul>
  </nav>
  <main>
    ${sectionsHtml}
  </main>
  <footer>
    <span class="text-es">Actualizado el</span>
    <span class="text-en">Updated on</span>
    ${timestamp}
  </footer>

  <!-- MODAL -->
  <div id="modal-overlay" role="dialog" aria-modal="true">
    <div id="modal">
      <div id="modal-image-wrap"><img id="modal-image" alt="" /></div>
      <div id="modal-header">
        <button class="modal-close" id="modal-close-btn" aria-label="Cerrar">✕</button>
        <div id="modal-name"></div>
        <div id="modal-base-price"></div>
        <div id="modal-description"></div>
      </div>
      <div id="modal-body"></div>
      <div id="modal-footer">
        <div class="total-block">
          <span class="total-label">Total</span>
          <span id="modal-total">$0.00</span>
        </div>
        <button class="btn-close-modal" id="modal-ok-btn">
          <span class="text-es">Listo</span>
          <span class="text-en">Done</span>
        </button>
      </div>
    </div>
  </div>

  <script id="menu-data" type="application/json">${menuDataJson}</script>
  <script>
    const MENU_DATA = JSON.parse(document.getElementById('menu-data').textContent);
    let currentItem = null;
    let selectedMods = {};

    function fmt(cents) {
      return '$' + (cents / 100).toFixed(2);
    }

    function getLang() {
      return document.documentElement.getAttribute('data-lang') || 'es';
    }

    function setLang(lang) {
      document.documentElement.setAttribute('data-lang', lang);
      document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
      });
      try { localStorage.setItem('menu-lang', lang); } catch(e) {}
    }

    // Restore saved language
    try {
      const saved = localStorage.getItem('menu-lang');
      if (saved) setLang(saved);
    } catch(e) {}

    function linkify(text) {
      if (!text) return '';
      return text.replace(/(https?:\\/\\/[^\\s]+)/g, function(url) {
        return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
      });
    }

    function openModal(itemId) {
      currentItem = MENU_DATA[itemId];
      if (!currentItem) return;
      selectedMods = {};

      const lang = getLang();

      // Image
      const imgWrap = document.getElementById('modal-image-wrap');
      const img = document.getElementById('modal-image');
      if (currentItem.imageUrl) {
        img.src = currentItem.imageUrl;
        imgWrap.style.display = 'block';
      } else {
        imgWrap.style.display = 'none';
      }

      // Header
      document.getElementById('modal-name').textContent = currentItem.name;
      document.getElementById('modal-base-price').textContent =
        currentItem.priceType === 'VARIABLE'
          ? (lang === 'en' ? 'Variable price' : 'Precio variable')
          : fmt(currentItem.price);

      const desc = lang === 'en'
        ? (currentItem.description_en || currentItem.description_es)
        : currentItem.description_es;

      const descEl = document.getElementById('modal-description');
      descEl.innerHTML = desc ? linkify(desc) : '';
      descEl.style.display = desc ? 'block' : 'none';

      // Modifier groups
      const body = document.getElementById('modal-body');
      body.innerHTML = '';

      const groups = (currentItem.modifierGroups || []).filter(g => g.modifiers && g.modifiers.length > 0);

      if (groups.length === 0) {
        body.innerHTML = '<p style="color:var(--cream-muted);font-size:.85rem;text-align:center;padding:1.5rem 0">' +
          (lang === 'en' ? 'No modifiers available' : 'Sin modificadores disponibles') + '</p>';
      } else {
        for (const group of groups) {
          const groupEl = document.createElement('div');
          groupEl.className = 'modifier-group';

          const labelEl = document.createElement('div');
          labelEl.className = 'modifier-group-name';
          labelEl.textContent = group.name;

          if (group.minRequired > 0) {
            const badge = document.createElement('span');
            badge.className = 'req-badge';
            badge.textContent = lang === 'en' ? 'Required' : 'Requerido';
            labelEl.appendChild(badge);
          } else if (group.maxAllowed === 1) {
            const badge = document.createElement('span');
            badge.className = 'req-badge';
            badge.textContent = lang === 'en' ? 'Choose 1' : 'Elige 1';
            labelEl.appendChild(badge);
          }

          groupEl.appendChild(labelEl);

          const optsEl = document.createElement('div');
          optsEl.className = 'modifier-options';

          for (const mod of group.modifiers) {
            const btn = document.createElement('button');
            btn.className = 'modifier-btn';
            btn.innerHTML =
              '<span class="mod-check">✓</span>' +
              '<span class="mod-name">' + mod.name + '</span>' +
              '<span class="modifier-price">' + (mod.price > 0 ? '+' + fmt(mod.price) : (lang === 'en' ? 'Included' : 'Incluido')) + '</span>';

            btn.addEventListener('click', () => toggleModifier(group.id, mod.id, group.maxAllowed));
            optsEl.appendChild(btn);
            mod._btn = btn;
          }

          groupEl.appendChild(optsEl);
          body.appendChild(groupEl);
        }
      }

      updateTotal();
      document.getElementById('modal-overlay').classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function closeModal() {
      document.getElementById('modal-overlay').classList.remove('open');
      document.body.style.overflow = '';
      currentItem = null;
      selectedMods = {};
    }

    function toggleModifier(groupId, modId, maxAllowed) {
      if (!selectedMods[groupId]) selectedMods[groupId] = new Set();
      const sel = selectedMods[groupId];

      if (maxAllowed === 1) {
        sel.clear();
        sel.add(modId);
      } else {
        if (sel.has(modId)) {
          sel.delete(modId);
        } else {
          if (maxAllowed === 0 || sel.size < maxAllowed) {
            sel.add(modId);
          }
        }
      }

      const group = currentItem.modifierGroups.find(g => g.id === groupId);
      if (group) {
        for (const mod of group.modifiers) {
          if (mod._btn) mod._btn.classList.toggle('selected', sel.has(mod.id));
        }
      }

      updateTotal();
    }

    function updateTotal() {
      if (!currentItem || currentItem.priceType === 'VARIABLE') return;
      let total = currentItem.price;
      for (const [groupId, sel] of Object.entries(selectedMods)) {
        const group = (currentItem.modifierGroups || []).find(g => g.id === groupId);
        if (!group) continue;
        for (const modId of sel) {
          const mod = group.modifiers.find(m => m.id === modId);
          if (mod) total += mod.price;
        }
      }
      document.getElementById('modal-total').textContent = fmt(total);
    }

    document.querySelectorAll('.menu-item.has-modifiers').forEach(el => {
      el.addEventListener('click', () => openModal(el.dataset.itemId));
    });

    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('modal-ok-btn').addEventListener('click', closeModal);

    document.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('modal-overlay')) closeModal();
    });

    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  </script>
</body>
</html>`;
}
