import type { CloverItem, CloverCategory, CloverModifierGroup } from "./clover";

const STRIPE_PK = "pk_live_51TeI6H2M0oDJ2A8nELGM2WdopsTWdzrrmIJNDDxq2u1L26KA7Bh9SAkzKqcrhYDFDQLDsjQ2aMfLoKHK1oyj93ct00dmJnTsyt";

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
    const activeCategories = itemCategories.filter((cat) => {
      const name = (categoryOrder.get(cat.id)?.name ?? cat.name).toLowerCase().trim();
      return !EXCLUDED_CATEGORIES.some((ex) => name.includes(ex));
    });
    if (itemCategories.length > 0 && activeCategories.length === 0) continue;
    if (activeCategories.length === 0) { uncategorized.push(item); continue; }
    const cat = activeCategories[0];
    const catInfo = categoryOrder.get(cat.id);
    const catName = catInfo?.name ?? cat.name;
    if (!sections.has(cat.id)) sections.set(cat.id, { category: catName, items: [] });
    sections.get(cat.id)!.items.push(item);
  }

  const sorted = [...sections.entries()]
    .sort(([aId], [bId]) => {
      const aOrder = categoryOrder.get(aId)?.order ?? 9999;
      const bOrder = categoryOrder.get(bId)?.order ?? 9999;
      return aOrder - bOrder;
    })
    .map(([, section]) => section);

  if (uncategorized.length > 0) sorted.push({ category: "Otros", items: uncategorized });
  return sorted;
}

function renderItem(item: CloverItem, translations: Record<string, string>): string {
  const priceHtml =
    item.priceType === "VARIABLE"
      ? `<span class="price">Precio variable</span>`
      : `<span class="price">${formatPrice(item.price)}</span>`;

  const descEs = item.description ?? "";
  const descEn = translations[item.id] ?? descEs;
  const descHtml = descEs
    ? `<p class="description text-es">${linkifyAndEscape(descEs)}</p>` +
      `<p class="description text-en">${linkifyAndEscape(descEn)}</p>`
    : "";

  const imageUrl = item.imageUrl ?? item.images?.elements?.[0]?.url;
  const imageHtml = imageUrl
    ? `<img class="item-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.name)}" loading="lazy" />`
    : "";

  const hasModifiers = (item.modifierGroups?.elements?.length ?? 0) > 0;

  if (hasModifiers) {
    return `
    <div class="menu-item has-modifiers" data-item-id="${escapeHtml(item.id)}">
      ${imageHtml}
      <div class="item-info">
        <div class="item-header">
          <h3 class="item-name">${escapeHtml(item.name)}</h3>
          ${priceHtml}
        </div>
        ${descHtml}
        <span class="modifier-hint text-es">Toca para personalizar</span>
        <span class="modifier-hint text-en">Tap to customize</span>
      </div>
    </div>`;
  } else {
    return `
    <div class="menu-item" data-item-id="${escapeHtml(item.id)}">
      ${imageHtml}
      <div class="item-info">
        <div class="item-header">
          <h3 class="item-name">${escapeHtml(item.name)}</h3>
          ${priceHtml}
        </div>
        ${descHtml}
      </div>
      ${item.priceType !== "VARIABLE" ? `<button class="quick-add-btn" data-item-id="${escapeHtml(item.id)}" aria-label="Agregar">+</button>` : ""}
    </div>`;
  }
}

function renderSection(section: MenuSection, translations: Record<string, string>): string {
  const itemsHtml = section.items.map((item) => renderItem(item, translations)).join("");
  const anchorId = section.category.toLowerCase().replace(/\s+/g, "-");
  return `
    <section class="menu-section" id="cat-${anchorId}">
      <h2 class="category-title">${escapeHtml(section.category)}</h2>
      <div class="items-grid">${itemsHtml}</div>
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

function escapeJs(str: string): string {
  return str.replace(/'/g, "\\'").replace(/\n/g, "\\n");
}

export function generateMenuHTML(
  restaurantName: string,
  items: CloverItem[],
  categories: CloverCategory[],
  modifierGroupsMap: Map<string, CloverModifierGroup>,
  translations: Record<string, string>,
  ordersApiUrl: string,
  generatedAt: Date
): string {
  const sections = groupItemsByCategory(items, categories);
  const sectionsHtml = sections.map((s) => renderSection(s, translations)).join("");
  const menuDataJson = buildMenuData(items, modifierGroupsMap, translations);
  const timestamp = generatedAt.toLocaleString("es-MX", { dateStyle: "long", timeStyle: "short" });

  return `<!DOCTYPE html>
<html lang="es" data-lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(restaurantName)} — Menú</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <script src="https://js.stripe.com/v3/"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0F2A1F; --surface: #0d2319; --surface2: #122d20;
      --border: rgba(201,169,97,.18); --gold: #C9A961; --gold-hover: #d9ba73;
      --cream: #F4EBDD; --cream-muted: rgba(244,235,221,.65); --bean: #0A1A12;
      --display: 'Instrument Serif','Times New Roman',serif;
      --ui: 'Manrope',system-ui,-apple-system,sans-serif;
      --radius: 10px;
    }
    body { background:var(--bg); color:var(--cream); font-family:var(--ui); -webkit-font-smoothing:antialiased; min-height:100vh; }
    ::selection { background:var(--gold); color:var(--bean); }
    [data-lang="es"] .text-en { display:none; }
    [data-lang="en"] .text-es { display:none; }

    /* HEADER */
    header { background:var(--bean); border-bottom:1px solid var(--border); padding:2.5rem 1rem 2rem; text-align:center; position:relative; }
    .header-logo-link { display:inline-block; margin-bottom:1.2rem; transition:transform .3s,opacity .3s; }
    .header-logo-link:hover { transform:scale(1.06); opacity:.88; }
    .header-logo { width:110px; height:110px; object-fit:contain; display:block; filter:drop-shadow(0 4px 18px rgba(0,0,0,.5)); }
    .header-eyebrow { font-size:11px; font-weight:500; letter-spacing:.28em; text-transform:uppercase; color:var(--gold); display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:.5rem; }
    .header-eyebrow::before,.header-eyebrow::after { content:''; width:28px; height:1px; background:var(--gold); opacity:.6; }
    header h1 { font-family:var(--display); font-style:italic; font-weight:400; font-size:clamp(2.2rem,6vw,4rem); color:var(--cream); letter-spacing:-0.01em; line-height:1.1; }

    /* LANG */
    .lang-switch { position:absolute; top:1.1rem; right:1.1rem; display:flex; align-items:center; background:rgba(201,169,97,.1); border:1px solid var(--border); border-radius:6px; overflow:hidden; }
    .lang-btn { background:none; border:none; color:var(--cream-muted); font-family:var(--ui); font-size:11px; font-weight:700; letter-spacing:.1em; padding:.4rem .65rem; cursor:pointer; transition:background .18s,color .18s; }
    .lang-btn.active { background:var(--gold); color:var(--bean); }
    .lang-btn:not(.active):hover { color:var(--gold); }
    .lang-divider { width:1px; height:18px; background:var(--border); }

    /* NAV */
    .category-nav { position:sticky; top:0; z-index:10; background:rgba(10,26,18,.92); border-bottom:1px solid var(--border); backdrop-filter:blur(12px); overflow-x:auto; scrollbar-width:none; }
    .category-nav::-webkit-scrollbar { display:none; }
    .category-nav__list { display:flex; list-style:none; padding:0 1rem; min-width:max-content; }
    .category-nav__list a { display:block; padding:.85rem 1.1rem; color:var(--cream-muted); text-decoration:none; font-size:11.5px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; white-space:nowrap; border-bottom:2px solid transparent; transition:color .2s,border-color .2s; }
    .category-nav__list a:hover { color:var(--gold); border-bottom-color:var(--gold); }

    /* MAIN */
    main { max-width:980px; margin:0 auto; padding:2.5rem 1rem 8rem; }
    .menu-section { margin-bottom:3.5rem; }
    .category-title { font-family:var(--display); font-style:italic; font-weight:400; font-size:clamp(1.6rem,3.5vw,2.2rem); color:var(--cream); margin-bottom:1.25rem; padding-bottom:.75rem; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:.75rem; }
    .category-title::after { content:''; flex:1; height:1px; background:var(--gold); opacity:.25; }

    /* GRID */
    .items-grid { display:grid; grid-template-columns:1fr; gap:.65rem; }
    @media(min-width:600px) { .items-grid { grid-template-columns:repeat(2,1fr); gap:.85rem; } }
    @media(min-width:880px) { .items-grid { grid-template-columns:repeat(3,1fr); } }

    /* ITEM CARD */
    .menu-item { background:var(--surface2); border:1px solid var(--border); border-radius:var(--radius); padding:1rem 1.15rem; display:flex; gap:0; align-items:flex-start; transition:border-color .25s,transform .25s,gap .25s; position:relative; }
    .menu-item.has-modifiers { cursor:pointer; }
    .menu-item:hover { border-color:rgba(201,169,97,.5); transform:translateY(-2px); gap:.9rem; }
    .item-image { width:72px; height:72px; object-fit:cover; border-radius:7px; flex-shrink:0; max-width:0; opacity:0; overflow:hidden; transition:max-width .3s,opacity .3s; }
    .menu-item:hover .item-image { max-width:72px; opacity:1; }
    .item-info { flex:1; min-width:0; }
    .item-header { display:flex; justify-content:space-between; align-items:baseline; gap:.6rem; }
    .item-name { font-size:.95rem; font-weight:600; color:var(--cream); line-height:1.3; }
    .price { font-size:.9rem; font-weight:700; color:var(--gold); white-space:nowrap; flex-shrink:0; }
    .description { max-height:0; overflow:hidden; opacity:0; margin-top:0; color:var(--cream-muted); font-size:.8rem; line-height:1.5; transition:max-height .3s,opacity .3s,margin-top .3s; }
    .menu-item:hover .description { max-height:120px; opacity:1; margin-top:.3rem; }
    .desc-link { color:var(--gold); text-decoration:underline; text-underline-offset:2px; }
    .modifier-hint { display:inline-flex; align-items:center; gap:4px; margin-top:.45rem; font-size:.7rem; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--gold); opacity:0; transition:opacity .25s; }
    .modifier-hint::before { content:'✦'; font-size:.55rem; }
    .menu-item:hover .modifier-hint { opacity:1; }

    /* QUICK ADD */
    .quick-add-btn { position:absolute; bottom:.75rem; right:.75rem; width:30px; height:30px; border-radius:50%; background:var(--gold); color:var(--bean); border:none; font-size:1.3rem; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; opacity:0; transform:scale(0.7); transition:opacity .2s,transform .2s,background .2s; }
    .menu-item:hover .quick-add-btn { opacity:1; transform:scale(1); }
    .quick-add-btn:hover { background:var(--gold-hover); }
    .quick-add-btn:active { transform:scale(0.92); }

    /* CART FAB */
    .cart-fab { position:fixed; bottom:1.5rem; right:1.5rem; z-index:100; display:none; align-items:center; gap:.6rem; background:var(--gold); color:var(--bean); border:none; border-radius:50px; padding:.75rem 1.2rem; font-family:var(--ui); font-size:.85rem; font-weight:700; cursor:pointer; box-shadow:0 4px 20px rgba(0,0,0,.4); transition:background .2s,transform .2s; }
    .cart-fab:hover { background:var(--gold-hover); transform:translateY(-2px); }
    .cart-fab-count { background:var(--bean); color:var(--gold); border-radius:50px; padding:1px 7px; font-size:.75rem; font-weight:700; }

    /* CART OVERLAY */
    .cart-overlay { display:none; position:fixed; inset:0; background:rgba(10,26,18,.6); backdrop-filter:blur(4px); z-index:150; }
    .cart-overlay.open { display:block; }

    /* CART DRAWER */
    .cart-drawer { position:fixed; top:0; right:0; bottom:0; z-index:160; width:min(440px,100vw); background:#0b1f14; border-left:1px solid var(--border); display:flex; flex-direction:column; transform:translateX(100%); transition:transform .3s cubic-bezier(.2,.6,.2,1); }
    .cart-drawer.open { transform:translateX(0); }
    .cart-drawer-header { padding:1.4rem 1.4rem 1rem; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; flex-shrink:0; }
    .cart-drawer-title { font-family:var(--display); font-style:italic; font-weight:400; font-size:1.6rem; color:var(--cream); }
    .cart-close-btn { background:rgba(201,169,97,.1); border:1px solid var(--border); border-radius:50%; width:32px; height:32px; color:var(--cream-muted); cursor:pointer; font-size:1rem; display:flex; align-items:center; justify-content:center; transition:color .2s,background .2s; }
    .cart-close-btn:hover { color:var(--cream); background:rgba(201,169,97,.2); }

    .cart-scroll { flex:1; overflow-y:auto; }
    .cart-scroll::-webkit-scrollbar { width:3px; }
    .cart-scroll::-webkit-scrollbar-thumb { background:var(--border); border-radius:3px; }

    .cart-items-list { padding:.75rem 1.4rem 0; }
    .cart-empty { text-align:center; padding:3rem 1rem; color:var(--cream-muted); font-size:.9rem; }
    .cart-empty-icon { font-size:2.5rem; margin-bottom:.75rem; }
    .cart-item { display:flex; align-items:center; gap:.75rem; padding:.85rem 0; border-bottom:1px solid var(--border); }
    .cart-item:last-child { border-bottom:none; }
    .cart-item-main { flex:1; min-width:0; }
    .cart-item-name { font-size:.9rem; font-weight:600; color:var(--cream); }
    .cart-item-mods { font-size:.75rem; color:var(--cream-muted); margin-top:2px; line-height:1.4; }
    .cart-item-price { font-size:.82rem; font-weight:700; color:var(--gold); margin-top:3px; }
    .cart-qty { display:flex; align-items:center; gap:.4rem; flex-shrink:0; }
    .cart-qty button { width:26px; height:26px; border-radius:50%; background:rgba(201,169,97,.12); border:1px solid var(--border); color:var(--cream); font-size:1rem; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background .15s; }
    .cart-qty button:hover { background:rgba(201,169,97,.25); }
    .cart-qty span { font-size:.9rem; font-weight:700; min-width:18px; text-align:center; }

    /* TOTALS */
    .cart-totals { padding:.75rem 1.4rem; border-top:1px solid var(--border); margin-top:.5rem; }
    .totals-row { display:flex; justify-content:space-between; align-items:center; padding:.22rem 0; font-size:.82rem; color:var(--cream-muted); }
    .totals-row span:last-child { font-weight:600; color:var(--cream); }
    .totals-divider { height:1px; background:var(--border); margin:.6rem 0; }
    .totals-total-row { font-size:1rem !important; }
    .totals-total-row span { color:var(--cream) !important; font-weight:700 !important; }
    .totals-total-row span:last-child { color:var(--gold) !important; font-size:1.2rem; }

    /* TIP */
    .tip-section { padding:.6rem 0 .4rem; }
    .tip-label { font-size:.7rem; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:var(--gold); margin-bottom:.5rem; }
    .tip-buttons { display:grid; grid-template-columns:repeat(3,1fr); gap:.35rem; margin-bottom:.5rem; }
    .tip-btn { padding:.42rem .3rem; background:rgba(255,255,255,.04); border:1px solid var(--border); border-radius:7px; color:var(--cream-muted); font-family:var(--ui); font-size:.78rem; font-weight:600; cursor:pointer; transition:border-color .15s,background .15s,color .15s; }
    .tip-btn:hover { border-color:rgba(201,169,97,.4); color:var(--cream); }
    .tip-btn.selected { border-color:var(--gold); background:rgba(201,169,97,.13); color:var(--gold); }

    /* CHECKOUT FORM */
    .cart-form { padding:.75rem 1.4rem 1.6rem; border-top:1px solid var(--border); flex-shrink:0; background:#0b1f14; }
    .form-input { width:100%; padding:.65rem .85rem; margin-bottom:.65rem; background:rgba(255,255,255,.04); border:1px solid var(--border); border-radius:8px; color:var(--cream); font-family:var(--ui); font-size:.84rem; outline:none; }
    .form-input:focus { border-color:rgba(201,169,97,.5); }
    .form-input::placeholder { color:var(--cream-muted); }
    .order-type-row { display:flex; gap:.6rem; margin-bottom:.65rem; }
    .order-type-btn { flex:1; padding:.55rem; background:rgba(255,255,255,.04); border:1px solid var(--border); border-radius:8px; color:var(--cream-muted); font-family:var(--ui); font-size:.8rem; font-weight:600; cursor:pointer; transition:border-color .15s,background .15s,color .15s; }
    .order-type-btn.selected { border-color:var(--gold); background:rgba(201,169,97,.1); color:var(--gold); }
    .stripe-card-wrap { background:rgba(255,255,255,.04); border:1px solid var(--border); border-radius:8px; padding:.7rem .85rem; margin-bottom:.65rem; transition:border-color .15s; }
    .stripe-card-wrap:focus-within { border-color:rgba(201,169,97,.5); }
    .stripe-error { font-size:.75rem; color:#ff6b6b; margin-bottom:.5rem; }
    .btn-pay { display:flex; align-items:center; justify-content:center; gap:.5rem; width:100%; padding:.85rem 1rem; background:var(--gold); color:var(--bean); border:none; border-radius:10px; font-family:var(--ui); font-size:.9rem; font-weight:700; letter-spacing:.06em; cursor:pointer; transition:background .2s,transform .2s; }
    .btn-pay:hover { background:var(--gold-hover); transform:translateY(-1px); }
    .btn-pay:disabled { opacity:.5; cursor:not-allowed; transform:none; }

    /* CONFIRMATION */
    .order-confirmed { text-align:center; padding:3rem 1.4rem; }
    .order-confirmed-icon { font-size:2.5rem; margin-bottom:1rem; }
    .order-confirmed-title { color:var(--cream); font-size:1rem; font-weight:700; margin-bottom:.4rem; }
    .order-confirmed-id { font-family:var(--display); font-style:italic; font-size:.9rem; color:var(--gold); margin-bottom:.75rem; }
    .order-confirmed-note { font-size:.8rem; color:var(--cream-muted); line-height:1.5; }
    .btn-new-order { margin-top:1.4rem; padding:.6rem 1.4rem; background:rgba(201,169,97,.12); border:1px solid var(--border); border-radius:8px; color:var(--gold); font-family:var(--ui); font-size:.8rem; font-weight:600; cursor:pointer; transition:background .18s; }
    .btn-new-order:hover { background:rgba(201,169,97,.22); }

    /* FOOTER */
    footer { text-align:center; color:var(--cream-muted); font-size:.72rem; letter-spacing:.08em; padding:2rem 1rem; border-top:1px solid var(--border); }

    /* MODAL */
    #modal-overlay { display:none; position:fixed; inset:0; background:rgba(10,26,18,.82); backdrop-filter:blur(10px); z-index:200; align-items:center; justify-content:center; padding:1rem; }
    #modal-overlay.open { display:flex; }
    #modal { background:#0e2518; border:1px solid rgba(201,169,97,.28); border-radius:16px; width:100%; max-width:460px; max-height:88vh; overflow-y:auto; position:relative; display:flex; flex-direction:column; }
    #modal::-webkit-scrollbar { width:4px; }
    #modal::-webkit-scrollbar-thumb { background:var(--border); border-radius:4px; }
    #modal-image-wrap { flex-shrink:0; overflow:hidden; border-radius:15px 15px 0 0; }
    #modal-image { width:100%; height:200px; object-fit:cover; display:block; }
    #modal-header { padding:1.4rem 1.4rem 1rem; position:sticky; top:0; background:#0e2518; z-index:1; border-bottom:1px solid var(--border); }
    .modal-close { position:absolute; top:1rem; right:1rem; background:rgba(201,169,97,.12); border:1px solid var(--border); border-radius:50%; width:30px; height:30px; color:var(--cream-muted); cursor:pointer; font-size:1rem; display:flex; align-items:center; justify-content:center; transition:color .2s,background .2s; }
    .modal-close:hover { color:var(--cream); background:rgba(201,169,97,.22); }
    #modal-name { font-family:var(--display); font-style:italic; font-size:1.55rem; color:var(--cream); line-height:1.15; padding-right:2rem; }
    #modal-base-price { font-size:1rem; font-weight:700; color:var(--gold); margin-top:.3rem; }
    #modal-desc-toggle { display:inline-flex; align-items:center; gap:5px; margin-top:.6rem; background:rgba(212,175,55,.1); border:1px solid rgba(212,175,55,.35); border-radius:20px; color:var(--gold); font-family:var(--ui); font-size:.78rem; font-weight:700; letter-spacing:.05em; cursor:pointer; padding:.25rem .7rem; opacity:1; transition:background .2s,border-color .2s; }
    #modal-desc-toggle:hover { background:rgba(212,175,55,.2); border-color:rgba(212,175,55,.6); }
    #modal-description { font-size:.82rem; color:var(--cream-muted); line-height:1.55; margin-top:.5rem; display:none; }
    #modal-description a { color:var(--gold); text-decoration:underline; text-underline-offset:2px; }
    #modal-description.open { display:block; }
    #modal-body { padding:1.2rem 1.4rem; flex:1; }
    .modifier-group { margin-bottom:1.4rem; }
    .modifier-group-name { font-size:.7rem; font-weight:700; letter-spacing:.2em; text-transform:uppercase; color:var(--gold); margin-bottom:.55rem; display:flex; align-items:center; gap:6px; }
    .req-badge { font-size:.6rem; font-weight:600; letter-spacing:.06em; background:rgba(201,169,97,.15); border:1px solid rgba(201,169,97,.3); border-radius:4px; padding:1px 5px; color:var(--gold); text-transform:uppercase; }
    .modifier-options { display:flex; flex-direction:column; gap:.4rem; }
    .modifier-btn { display:flex; justify-content:space-between; align-items:center; padding:.7rem 1rem; background:rgba(255,255,255,.03); border:1px solid var(--border); border-radius:8px; color:var(--cream); font-family:var(--ui); font-size:.875rem; cursor:pointer; transition:border-color .18s,background .18s; text-align:left; width:100%; gap:.75rem; }
    .modifier-btn:hover { border-color:rgba(201,169,97,.45); background:rgba(201,169,97,.06); }
    .modifier-btn.selected { border-color:var(--gold); background:rgba(201,169,97,.13); }
    .modifier-btn .mod-name { flex:1; }
    .mod-check { width:18px; height:18px; border:1.5px solid var(--border); border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:.65rem; color:transparent; transition:border-color .18s,background .18s; }
    .modifier-btn.selected .mod-check { border-color:var(--gold); background:var(--gold); color:var(--bean); }
    .modifier-price { font-size:.8rem; font-weight:600; color:var(--cream-muted); white-space:nowrap; flex-shrink:0; }
    .modifier-btn.selected .modifier-price { color:var(--gold); }
    #modal-footer { padding:1rem 1.4rem 1.4rem; border-top:1px solid var(--border); position:sticky; bottom:0; background:#0e2518; display:flex; align-items:center; justify-content:space-between; gap:1rem; }
    .total-block { display:flex; flex-direction:column; }
    .total-label { font-size:.65rem; font-weight:600; letter-spacing:.18em; text-transform:uppercase; color:var(--cream-muted); }
    #modal-total { font-family:var(--display); font-style:italic; font-size:2rem; color:var(--gold); line-height:1; }
    .btn-add-to-cart { padding:.7rem 1.2rem; background:var(--gold); color:var(--bean); border:none; border-radius:8px; font-family:var(--ui); font-size:.8rem; font-weight:700; letter-spacing:.08em; cursor:pointer; transition:background .2s,transform .2s; white-space:nowrap; }
    .btn-add-to-cart:hover { background:var(--gold-hover); transform:translateY(-1px); }
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
      <span class="text-es">Menú</span><span class="text-en">Menu</span>
    </div>
    <h1>${escapeHtml(restaurantName)}</h1>
  </header>

  <nav class="category-nav" aria-label="Categorías">
    <ul class="category-nav__list">
      ${sections.map((s) => `<li><a href="#cat-${s.category.toLowerCase().replace(/\s+/g, "-")}">${escapeHtml(s.category)}</a></li>`).join("")}
    </ul>
  </nav>

  <main>${sectionsHtml}</main>

  <footer>
    <span class="text-es">Actualizado el</span><span class="text-en">Updated on</span> ${timestamp}
  </footer>

  <!-- CART FAB -->
  <button class="cart-fab" id="cart-fab" onclick="openCartDrawer()">
    <span>🛒</span>
    <span class="cart-fab-count" id="cart-count">0</span>
    <span id="cart-fab-total">$0.00</span>
  </button>

  <!-- CART OVERLAY -->
  <div class="cart-overlay" id="cart-overlay" onclick="closeCartDrawer()"></div>

  <!-- CART DRAWER -->
  <div class="cart-drawer" id="cart-drawer">
    <div class="cart-drawer-header">
      <h2 class="cart-drawer-title">
        <span class="text-es">Tu Orden</span><span class="text-en">Your Order</span>
      </h2>
      <button class="cart-close-btn" onclick="closeCartDrawer()">✕</button>
    </div>

    <!-- Confirmation screen (hidden until order placed) -->
    <div id="cart-confirmed" style="display:none;text-align:center;padding:3rem 1.4rem">
      <div style="font-size:2.5rem;margin-bottom:1rem">✅</div>
      <div id="conf-title" class="order-confirmed-title"></div>
      <div id="conf-id" class="order-confirmed-id"></div>
      <div id="conf-note" class="order-confirmed-note"></div>
      <button class="btn-new-order" onclick="resetDrawer()">
        <span class="text-es">Nueva orden</span><span class="text-en">New order</span>
      </button>
    </div>

    <div class="cart-scroll" id="cart-main">
      <!-- Items -->
      <div class="cart-items-list" id="cart-items-list"></div>

      <!-- Totals -->
      <div class="cart-totals" id="cart-totals" style="display:none;">
        <div class="totals-row">
          <span><span class="text-es">Subtotal</span><span class="text-en">Subtotal</span></span>
          <span id="t-subtotal">$0.00</span>
        </div>
        <div class="totals-row">
          <span><span class="text-es">Impuesto (8.25%)</span><span class="text-en">Tax (8.25%)</span></span>
          <span id="t-tax">$0.00</span>
        </div>
        <div class="totals-row">
          <span><span class="text-es">Servicio (4%)</span><span class="text-en">Service fee (4%)</span></span>
          <span id="t-service">$0.00</span>
        </div>

        <!-- Tip -->
        <div class="tip-section">
          <div class="tip-label"><span class="text-es">Propina</span><span class="text-en">Tip</span></div>
          <div class="tip-buttons">
            <button class="tip-btn" data-tip="15" onclick="setTip('pct',15)">15%</button>
            <button class="tip-btn" data-tip="18" onclick="setTip('pct',18)">18%</button>
            <button class="tip-btn" data-tip="20" onclick="setTip('pct',20)">20%</button>
            <button class="tip-btn" data-tip="30" onclick="setTip('pct',30)">30%</button>
            <button class="tip-btn" data-tip="custom" onclick="setTip('custom',0)">
              <span class="text-es">Otra</span><span class="text-en">Custom</span>
            </button>
            <button class="tip-btn selected" data-tip="none" onclick="setTip('none',0)">
              <span class="text-es">Sin propina</span><span class="text-en">No tip</span>
            </button>
          </div>
          <div id="custom-tip-wrap" style="display:none;margin-bottom:.4rem">
            <input type="number" id="custom-tip-input" class="form-input" min="0" step="0.01"
              placeholder="$0.00" oninput="setTip('custom',0)" style="margin-bottom:0" />
          </div>
        </div>

        <div class="totals-row">
          <span><span class="text-es">Propina</span><span class="text-en">Tip</span></span>
          <span id="t-tip">$0.00</span>
        </div>
        <div class="totals-divider"></div>
        <div class="totals-row totals-total-row">
          <span>Total</span>
          <span id="t-total">$0.00</span>
        </div>
      </div>
    </div><!-- end cart-main -->

    <!-- Checkout form -->
    <div class="cart-form" id="cart-form" style="display:none">
      <input type="text" id="customer-name" class="form-input" placeholder="Nombre / Name *" maxlength="60" />
      <div class="order-type-row">
        <button class="order-type-btn" id="btn-table" onclick="selectOrderType('table')">
          🪑 <span class="text-es">Mesa</span><span class="text-en">Table</span>
        </button>
        <button class="order-type-btn" id="btn-togo" onclick="selectOrderType('togo')">
          🥡 <span class="text-es">Para llevar</span><span class="text-en">To-go</span>
        </button>
      </div>
      <div id="table-num-wrap" style="display:none">
        <input type="text" id="table-number" class="form-input" placeholder="# de mesa / Table # *" maxlength="10" />
      </div>
      <div class="stripe-card-wrap">
        <div id="stripe-card-element"></div>
      </div>
      <div id="stripe-error" class="stripe-error" style="display:none"></div>
      <button class="btn-pay" id="btn-pay" onclick="placeOrder()">
        <span class="text-es">Pagar</span><span class="text-en">Pay</span>
        <span id="pay-total">$0.00</span>
      </button>
    </div>
  </div>

  <!-- MODAL -->
  <div id="modal-overlay" role="dialog" aria-modal="true">
    <div id="modal">
      <div id="modal-image-wrap"><img id="modal-image" alt="" /></div>
      <div id="modal-header">
        <button class="modal-close" id="modal-close-btn" aria-label="Cerrar">✕</button>
        <div id="modal-name"></div>
        <div id="modal-base-price"></div>
        <button id="modal-desc-toggle" onclick="toggleDesc()" style="display:none">
          <span id="modal-desc-toggle-text"></span> <span id="modal-desc-arrow">▾</span>
        </button>
        <div id="modal-description"></div>
      </div>
      <div id="modal-body"></div>
      <div id="modal-footer">
        <div class="total-block">
          <span class="total-label">Total</span>
          <span id="modal-total">$0.00</span>
        </div>
        <button class="btn-add-to-cart" id="modal-add-btn">
          <span class="text-es">Agregar al carrito</span>
          <span class="text-en">Add to cart</span>
        </button>
      </div>
    </div>
  </div>

  <script id="menu-data" type="application/json">${menuDataJson}</script>
  <script>
    var MENU_DATA = JSON.parse(document.getElementById('menu-data').textContent);
    var ORDERS_API_URL = '${escapeJs(ordersApiUrl)}';
    var PAYMENT_INTENT_URL = ORDERS_API_URL.replace('/create-order', '/create-payment-intent');

    var TAX_RATE = 0.0825;
    var SERVICE_RATE = 0.04;
    var selectedTipCents = 0;
    var tipMode = 'none';
    var orderType = '';

    // ── LANGUAGE ──
    function getLang() { return document.documentElement.getAttribute('data-lang') || 'es'; }
    function setLang(lang) {
      document.documentElement.setAttribute('data-lang', lang);
      document.querySelectorAll('.lang-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.lang === lang); });
      try { localStorage.setItem('menu-lang', lang); } catch(e) {}
    }
    try { var sl = localStorage.getItem('menu-lang'); if (sl) setLang(sl); } catch(e) {}

    // ── CART ──
    var cart = [];
    try { var sc = localStorage.getItem('cafearte-cart'); if (sc) cart = JSON.parse(sc); } catch(e) {}

    function saveCart() { try { localStorage.setItem('cafearte-cart', JSON.stringify(cart)); } catch(e) {} }

    function cartSubtotal() { return cart.reduce(function(s,i) { return s + i.unitTotal * i.quantity; }, 0); }
    function cartTax() { return Math.round(cartSubtotal() * TAX_RATE); }
    function cartService() { return Math.round(cartSubtotal() * SERVICE_RATE); }
    function cartGrand() { return cartSubtotal() + cartTax() + cartService() + selectedTipCents; }
    function fmt(c) { return '$' + (c / 100).toFixed(2); }

    function updateBadge() {
      var count = cart.reduce(function(s,i) { return s + i.quantity; }, 0);
      document.getElementById('cart-count').textContent = count;
      document.getElementById('cart-fab-total').textContent = fmt(cartSubtotal());
      document.getElementById('cart-fab').style.display = count > 0 ? 'flex' : 'none';
    }

    function updateTotals() {
      var sub = cartSubtotal();
      var hasItems = cart.length > 0;
      document.getElementById('cart-totals').style.display = hasItems ? 'block' : 'none';
      document.getElementById('cart-form').style.display = hasItems ? 'block' : 'none';
      if (!hasItems) return;
      if (tipMode === 'pct') selectedTipCents = Math.round(sub * tipMode_pct / 100);
      if (tipMode === 'custom') {
        var v = parseFloat(document.getElementById('custom-tip-input').value) || 0;
        selectedTipCents = Math.round(v * 100);
      }
      document.getElementById('t-subtotal').textContent = fmt(sub);
      document.getElementById('t-tax').textContent = fmt(cartTax());
      document.getElementById('t-service').textContent = fmt(cartService());
      document.getElementById('t-tip').textContent = fmt(selectedTipCents);
      document.getElementById('t-total').textContent = fmt(cartGrand());
      document.getElementById('pay-total').textContent = fmt(cartGrand());
    }

    var tipMode_pct = 0;
    function setTip(mode, pct) {
      tipMode = mode;
      tipMode_pct = pct;
      if (mode === 'none') selectedTipCents = 0;
      else if (mode === 'pct') selectedTipCents = Math.round(cartSubtotal() * pct / 100);
      else if (mode === 'custom') {
        var v = parseFloat(document.getElementById('custom-tip-input').value) || 0;
        selectedTipCents = Math.round(v * 100);
      }
      document.querySelectorAll('.tip-btn').forEach(function(b) {
        b.classList.toggle('selected',
          (b.dataset.tip === String(pct) && mode === 'pct') ||
          (b.dataset.tip === mode && mode !== 'pct')
        );
      });
      document.getElementById('custom-tip-wrap').style.display = mode === 'custom' ? 'block' : 'none';
      updateTotals();
    }

    function selectOrderType(type) {
      orderType = type;
      document.getElementById('btn-table').classList.toggle('selected', type === 'table');
      document.getElementById('btn-togo').classList.toggle('selected', type === 'togo');
      document.getElementById('table-num-wrap').style.display = type === 'table' ? 'block' : 'none';
    }

    function renderCartItems() {
      var el = document.getElementById('cart-items-list');
      var lang = getLang();
      if (cart.length === 0) {
        el.innerHTML = '<div class="cart-empty"><div class="cart-empty-icon">☕</div><p>' +
          (lang === 'en' ? 'Your cart is empty' : 'Tu carrito está vacío') + '</p></div>';
        return;
      }
      var html = '';
      for (var i = 0; i < cart.length; i++) {
        var item = cart[i];
        var modsHtml = '';
        if (item.modifiers && item.modifiers.length > 0) {
          modsHtml = '<div class="cart-item-mods">' +
            item.modifiers.map(function(m) { return m.name + (m.price > 0 ? ' +' + fmt(m.price) : ''); }).join(', ') +
            '</div>';
        }
        html += '<div class="cart-item">' +
          '<div class="cart-item-main">' +
            '<div class="cart-item-name">' + item.name + '</div>' + modsHtml +
            '<div class="cart-item-price">' + fmt(item.unitTotal) + ' c/u</div>' +
          '</div>' +
          '<div class="cart-qty">' +
            '<button onclick="updateQty(' + i + ',-1)">&#8722;</button>' +
            '<span>' + item.quantity + '</span>' +
            '<button onclick="updateQty(' + i + ',1)">+</button>' +
          '</div></div>';
      }
      el.innerHTML = html;
    }

    function addToCart(itemId, selectedModsObj) {
      var item = MENU_DATA[itemId];
      if (!item || item.priceType === 'VARIABLE') return;
      var modifiers = [];
      var extra = 0;
      for (var gId in selectedModsObj) {
        var group = (item.modifierGroups || []).filter(function(g) { return g.id === gId; })[0];
        if (!group) continue;
        var modIds = selectedModsObj[gId];
        for (var k = 0; k < modIds.length; k++) {
          var mod = group.modifiers.filter(function(m) { return m.id === modIds[k]; })[0];
          if (mod) { modifiers.push({ id: mod.id, name: mod.name, price: mod.price }); extra += mod.price; }
        }
      }
      var unitTotal = item.price + extra;
      var modsKey = JSON.stringify(modifiers);
      var found = -1;
      for (var j = 0; j < cart.length; j++) {
        if (cart[j].itemId === itemId && JSON.stringify(cart[j].modifiers) === modsKey) { found = j; break; }
      }
      if (found >= 0) { cart[found].quantity++; }
      else { cart.push({ itemId: itemId, name: item.name, price: item.price, modifiers: modifiers, quantity: 1, unitTotal: unitTotal }); }
      saveCart(); updateBadge(); renderCartItems(); updateTotals();
      var fab = document.getElementById('cart-fab');
      fab.style.transform = 'translateY(-4px) scale(1.08)';
      setTimeout(function() { fab.style.transform = ''; }, 250);
    }

    function updateQty(index, delta) {
      cart[index].quantity += delta;
      if (cart[index].quantity <= 0) cart.splice(index, 1);
      saveCart(); updateBadge(); renderCartItems(); updateTotals();
    }

    function openCartDrawer() {
      renderCartItems(); updateTotals();
      document.getElementById('cart-drawer').classList.add('open');
      document.getElementById('cart-overlay').classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function closeCartDrawer() {
      document.getElementById('cart-drawer').classList.remove('open');
      document.getElementById('cart-overlay').classList.remove('open');
      document.body.style.overflow = '';
    }

    // Quick add
    document.querySelectorAll('.quick-add-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        addToCart(btn.dataset.itemId, {});
      });
    });

    // ── HELPERS ──
    async function fetchWithRetry(url, options) {
      try { return await fetch(url, options); }
      catch(e) {
        await new Promise(function(r) { setTimeout(r, 1500); });
        return fetch(url, options);
      }
    }

    // ── PLACE ORDER ──
    async function placeOrder() {
      var lang = getLang();
      var name = document.getElementById('customer-name').value.trim();
      if (!name) {
        alert(lang === 'en' ? 'Please enter your name.' : 'Por favor ingresa tu nombre.');
        return;
      }
      if (!orderType) {
        alert(lang === 'en' ? 'Select Table or To-go.' : 'Selecciona Mesa o Para llevar.');
        return;
      }
      var tableNote = '';
      if (orderType === 'table') {
        var tnum = document.getElementById('table-number').value.trim();
        if (!tnum) {
          alert(lang === 'en' ? 'Please enter the table number.' : 'Por favor ingresa el número de mesa.');
          return;
        }
        tableNote = (lang === 'en' ? 'Table ' : 'Mesa ') + tnum;
      } else {
        tableNote = lang === 'en' ? 'To-go' : 'Para llevar';
      }

      var total = cartGrand();
      if (total < 50) { alert('El total mínimo es $0.50'); return; }

      var btn = document.getElementById('btn-pay');
      btn.disabled = true;
      btn.querySelector('.text-es').textContent = 'Procesando...';
      btn.querySelector('.text-en').textContent = 'Processing...';

      try {
        // 1. Create PaymentIntent (retry once on cold start)
        var piRes = await fetchWithRetry(PAYMENT_INTENT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: total })
        });
        var piData = await piRes.json();
        if (!piData.clientSecret) throw new Error(piData.error || 'Error al iniciar el pago');

        // 2. Confirm with Stripe
        var result = await stripe.confirmCardPayment(piData.clientSecret, {
          payment_method: { card: cardElement, billing_details: { name: name } }
        });
        if (result.error) throw new Error(result.error.message);

        // 3. Create Clover order
        var orderRes = await fetch(ORDERS_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: cart,
            customerName: name,
            tableNote: tableNote,
            taxCents: cartTax(),
            serviceFeeCents: cartService(),
            tipCents: selectedTipCents,
            totalCents: total,
            paymentIntentId: result.paymentIntent.id
          })
        });
        var orderData = await orderRes.json();
        if (!orderData.orderId) throw new Error(orderData.error || 'Error al registrar la orden');

        showConfirmation(orderData.orderId, name);

      } catch(err) {
        btn.disabled = false;
        btn.querySelector('.text-es').textContent = 'Pagar';
        btn.querySelector('.text-en').textContent = 'Pay';
        document.getElementById('stripe-error').textContent = err.message;
        document.getElementById('stripe-error').style.display = 'block';
      }
    }

    function showConfirmation(orderId, name) {
      cart = []; selectedTipCents = 0; tipMode = 'none'; orderType = '';
      saveCart(); updateBadge();
      var lang = getLang();
      document.getElementById('conf-title').textContent =
        lang === 'en' ? 'Order placed, ' + name + '!' : '¡Pedido enviado, ' + name + '!';
      document.getElementById('conf-id').textContent = '# ' + orderId;
      document.getElementById('conf-note').textContent =
        lang === 'en' ? 'Your payment was processed. Staff will prepare your order shortly.'
                      : 'Tu pago fue procesado. El staff preparará tu orden en breve.';
      document.getElementById('cart-confirmed').style.display = 'block';
      document.getElementById('cart-main').style.display = 'none';
      document.getElementById('cart-form').style.display = 'none';
    }

    function resetDrawer() {
      document.getElementById('cart-confirmed').style.display = 'none';
      document.getElementById('cart-main').style.display = 'block';
      renderCartItems(); updateTotals();
      var btn = document.getElementById('btn-pay');
      if (btn) {
        btn.disabled = false;
        btn.querySelector('.text-es').textContent = 'Pagar';
        btn.querySelector('.text-en').textContent = 'Pay';
      }
      document.getElementById('stripe-error').style.display = 'none';
      orderType = '';
      document.getElementById('btn-table').classList.remove('selected');
      document.getElementById('btn-togo').classList.remove('selected');
      document.getElementById('table-num-wrap').style.display = 'none';
      document.getElementById('customer-name').value = '';
    }

    // ── MODAL ──
    var currentItem = null;
    var currentItemId = null;
    var selectedMods = {};

    function toggleDesc() {
      var descEl = document.getElementById('modal-description');
      var arrow = document.getElementById('modal-desc-arrow');
      var toggleText = document.getElementById('modal-desc-toggle-text');
      var lang = getLang();
      var open = descEl.classList.toggle('open');
      arrow.textContent = open ? '▴' : '▾';
      toggleText.textContent = open
        ? (lang === 'en' ? 'Hide description' : 'Ocultar descripción')
        : (lang === 'en' ? 'See description' : 'Ver descripción');
    }

    function linkify(text) {
      if (!text) return '';
      return text.replace(/(https?:\\/\\/[^\\s]+)/g, function(url) {
        return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
      });
    }

    function openModal(itemId) {
      currentItemId = itemId;
      currentItem = MENU_DATA[itemId];
      if (!currentItem) return;
      selectedMods = {};
      var lang = getLang();
      var imgWrap = document.getElementById('modal-image-wrap');
      var img = document.getElementById('modal-image');
      if (currentItem.imageUrl) { img.src = currentItem.imageUrl; imgWrap.style.display = 'block'; }
      else { imgWrap.style.display = 'none'; }
      document.getElementById('modal-name').textContent = currentItem.name;
      document.getElementById('modal-base-price').textContent =
        currentItem.priceType === 'VARIABLE' ? (lang === 'en' ? 'Variable price' : 'Precio variable') : fmt(currentItem.price);
      var desc = lang === 'en' ? (currentItem.description_en || currentItem.description_es) : currentItem.description_es;
      var descEl = document.getElementById('modal-description');
      var toggleBtn = document.getElementById('modal-desc-toggle');
      descEl.innerHTML = desc ? linkify(desc) : '';
      descEl.classList.remove('open');
      if (desc) {
        toggleBtn.style.display = 'inline-flex';
        document.getElementById('modal-desc-toggle-text').textContent = lang === 'en' ? 'See description' : 'Ver descripción';
        document.getElementById('modal-desc-arrow').textContent = '▾';
      } else {
        toggleBtn.style.display = 'none';
      }
      var body = document.getElementById('modal-body');
      body.innerHTML = '';
      var groups = (currentItem.modifierGroups || []).filter(function(g) { return g.modifiers && g.modifiers.length > 0; });
      if (groups.length === 0) {
        body.innerHTML = '<p style="color:var(--cream-muted);font-size:.85rem;text-align:center;padding:1.5rem 0">' +
          (lang === 'en' ? 'No modifiers available' : 'Sin modificadores disponibles') + '</p>';
      } else {
        for (var gi = 0; gi < groups.length; gi++) {
          var group = groups[gi];
          var groupEl = document.createElement('div');
          groupEl.className = 'modifier-group';
          var labelEl = document.createElement('div');
          labelEl.className = 'modifier-group-name';
          labelEl.textContent = group.name;
          if (group.minRequired > 0) {
            var badge = document.createElement('span');
            badge.className = 'req-badge';
            badge.textContent = lang === 'en' ? 'Required' : 'Requerido';
            labelEl.appendChild(badge);
          } else if (group.maxAllowed === 1) {
            var badge2 = document.createElement('span');
            badge2.className = 'req-badge';
            badge2.textContent = lang === 'en' ? 'Choose 1' : 'Elige 1';
            labelEl.appendChild(badge2);
          }
          groupEl.appendChild(labelEl);
          var optsEl = document.createElement('div');
          optsEl.className = 'modifier-options';
          for (var mi = 0; mi < group.modifiers.length; mi++) {
            var mod = group.modifiers[mi];
            var btn = document.createElement('button');
            btn.className = 'modifier-btn';
            btn.innerHTML = '<span class="mod-check">&#10003;</span>' +
              '<span class="mod-name">' + mod.name + '</span>' +
              '<span class="modifier-price">' + (mod.price > 0 ? '+' + fmt(mod.price) : (lang === 'en' ? 'Included' : 'Incluido')) + '</span>';
            (function(gId, mId, gMax, b) {
              b.addEventListener('click', function() { toggleModifier(gId, mId, gMax); });
            })(group.id, mod.id, group.maxAllowed, btn);
            optsEl.appendChild(btn);
            mod._btn = btn;
          }
          groupEl.appendChild(optsEl);
          body.appendChild(groupEl);
        }
      }
      updateModalTotal();
      document.getElementById('modal-overlay').classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function closeModal() {
      document.getElementById('modal-overlay').classList.remove('open');
      document.body.style.overflow = '';
      currentItem = null; currentItemId = null; selectedMods = {};
    }

    function toggleModifier(groupId, modId, maxAllowed) {
      if (!selectedMods[groupId]) selectedMods[groupId] = [];
      var sel = selectedMods[groupId];
      var idx = sel.indexOf(modId);
      if (maxAllowed === 1) { selectedMods[groupId] = [modId]; }
      else {
        if (idx >= 0) { sel.splice(idx, 1); }
        else if (maxAllowed === 0 || sel.length < maxAllowed) { sel.push(modId); }
      }
      var group = (currentItem.modifierGroups || []).filter(function(g) { return g.id === groupId; })[0];
      if (group) {
        for (var i = 0; i < group.modifiers.length; i++) {
          var mod = group.modifiers[i];
          if (mod._btn) mod._btn.classList.toggle('selected', selectedMods[groupId].indexOf(mod.id) >= 0);
        }
      }
      updateModalTotal();
    }

    function updateModalTotal() {
      if (!currentItem) return;
      var total = currentItem.priceType === 'VARIABLE' ? 0 : currentItem.price;
      for (var gId in selectedMods) {
        var group = (currentItem.modifierGroups || []).filter(function(g) { return g.id === gId; })[0];
        if (!group) continue;
        for (var i = 0; i < selectedMods[gId].length; i++) {
          var mod = group.modifiers.filter(function(m) { return m.id === selectedMods[gId][i]; })[0];
          if (mod) total += mod.price;
        }
      }
      document.getElementById('modal-total').textContent = fmt(total);
      var addBtn = document.getElementById('modal-add-btn');
      if (addBtn && currentItem.priceType !== 'VARIABLE') {
        var lang = getLang();
        addBtn.querySelector('.text-es').textContent = 'Agregar · ' + fmt(total);
        addBtn.querySelector('.text-en').textContent = 'Add · ' + fmt(total);
      }
    }

    function addCurrentToCart() {
      if (!currentItemId || !currentItem) return;
      var modsObj = {};
      for (var gId in selectedMods) { modsObj[gId] = selectedMods[gId].slice(); }
      addToCart(currentItemId, modsObj);
      closeModal(); openCartDrawer();
    }

    document.querySelectorAll('.menu-item.has-modifiers').forEach(function(el) {
      el.addEventListener('click', function() { openModal(el.dataset.itemId); });
    });
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('modal-add-btn').addEventListener('click', addCurrentToCart);
    document.getElementById('modal-overlay').addEventListener('click', function(e) {
      if (e.target === document.getElementById('modal-overlay')) closeModal();
    });
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') { closeModal(); closeCartDrawer(); } });

    // ── STRIPE ──
    var stripe = Stripe('${STRIPE_PK}');
    var elements = stripe.elements();
    var cardElement = elements.create('card', {
      hidePostalCode: true,
      style: {
        base: { color: '#F4EBDD', fontFamily: '"Manrope", system-ui, sans-serif', fontSize: '14px', '::placeholder': { color: 'rgba(244,235,221,0.45)' } },
        invalid: { color: '#ff6b6b' }
      }
    });
    cardElement.mount('#stripe-card-element');
    cardElement.on('change', function(e) {
      var errEl = document.getElementById('stripe-error');
      if (e.error) { errEl.textContent = e.error.message; errEl.style.display = 'block'; }
      else { errEl.style.display = 'none'; }
    });

    updateBadge();
    renderCartItems();
  </script>
</body>
</html>`;
}
