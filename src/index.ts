import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { CloverClient, CloverModifierGroup } from "./clover";
import { generateMenuHTML } from "./template";
import { translateDescriptions } from "./translator";

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variable de entorno requerida no encontrada: ${name}\n` +
        `Copia .env.example a .env y completa tus credenciales.`
    );
  }
  return value;
}

type CacheEntry = { source: string; translation: string };

async function main() {
  const token = requireEnv("CLOVER_API_TOKEN");
  const merchantId = requireEnv("CLOVER_MERCHANT_ID");
  const region = process.env.CLOVER_REGION ?? "us";
  const restaurantName = process.env.RESTAURANT_NAME ?? "Mi Restaurante";
  const outputDir = process.env.OUTPUT_DIR ?? "./output";

  console.log(`\n🍽  Generando menú para: ${restaurantName}`);
  console.log(`📡 Conectando a Clover API (${region})...\n`);

  const client = new CloverClient(token, merchantId, region);

  console.log("📦 Obteniendo productos...");
  const [items, categories, modifierGroupsList] = await Promise.all([
    client.getItems(),
    client.getCategories(),
    client.getModifierGroups(),
  ]);

  const modifierGroupsMap = new Map<string, CloverModifierGroup>(
    modifierGroupsList.map((g) => [g.id, g])
  );

  const visibleItems = items.filter((item) => !item.hidden);

  console.log(`   ${visibleItems.length} productos encontrados`);
  console.log(`   ${categories.length} categorías encontradas`);
  console.log(`   ${modifierGroupsList.length} grupos de modificadores encontrados\n`);

  if (visibleItems.length === 0) {
    console.warn("⚠️  No se encontraron productos visibles.");
    process.exit(1);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Load translation cache
  const cacheFile = path.join(outputDir, "translations-cache.json");
  let cache: Record<string, CacheEntry> = {};
  if (fs.existsSync(cacheFile)) {
    try { cache = JSON.parse(fs.readFileSync(cacheFile, "utf-8")); } catch {}
  }

  // Split into cached vs needs translation
  const toTranslate: Record<string, string> = {};
  const translations: Record<string, string> = {};

  for (const item of visibleItems) {
    const desc = item.description?.trim() ?? "";
    if (!desc) continue;
    if (cache[item.id] && cache[item.id].source === desc) {
      translations[item.id] = cache[item.id].translation;
    } else {
      toTranslate[item.id] = desc;
    }
  }

  const toTranslateCount = Object.keys(toTranslate).length;
  const cachedCount = Object.keys(translations).length;

  if (toTranslateCount > 0) {
    console.log(`  💾 ${cachedCount} traducciones en caché`);
    const newTranslations = await translateDescriptions(toTranslate).catch((e) => {
      console.warn(`  ⚠️  Error al traducir: ${e.cause?.code ?? e.message}`);
      return {} as Record<string, string>;
    });

    for (const [id, translation] of Object.entries(newTranslations)) {
      translations[id] = translation;
      cache[id] = { source: toTranslate[id], translation };
    }
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), "utf-8");
  } else {
    console.log(`  ✓ ${cachedCount} traducciones en caché (sin cambios)\n`);
  }

  console.log("🎨 Generando HTML...");
  const html = generateMenuHTML(
    restaurantName,
    visibleItems,
    categories,
    modifierGroupsMap,
    translations,
    new Date()
  );

  const outputPath = path.join(outputDir, "menu.html");
  fs.writeFileSync(outputPath, html, "utf-8");

  console.log(`✅ Menú generado exitosamente: ${outputPath}`);
  console.log(`\nPuedes abrir el archivo en tu navegador o subirlo a tu servidor web.\n`);
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
