import * as https from "https";

const BATCH_SIZE = 10;

function httpsPost(
  apiKey: string,
  body: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
        timeout: 90000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    req.write(body);
    req.end();
  });
}

async function translateBatch(
  apiKey: string,
  batch: [string, string][]
): Promise<Record<string, string>> {
  const payload = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content:
          `Translate the values of this JSON object from Spanish to English. ` +
          `Return ONLY a raw JSON object with the same keys and translated values. ` +
          `No markdown, no code blocks, no explanation — just the JSON object. ` +
          `Keep any URLs or special characters intact. Be concise and natural.\n\n` +
          JSON.stringify(Object.fromEntries(batch)),
      },
    ],
  });

  const raw = await httpsPost(apiKey, payload);
  const data = JSON.parse(raw) as { content?: Array<{ type: string; text: string }>; error?: { message: string } };

  if (data.error) throw new Error(data.error.message);

  const text = data.content?.[0]?.text ?? "";
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return {};
    return JSON.parse(match[0]);
  } catch {
    return {};
  }
}

export async function translateDescriptions(
  descriptions: Record<string, string>
): Promise<Record<string, string>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("  ⚠️  ANTHROPIC_API_KEY no encontrado, omitiendo traducción");
    return {};
  }

  const entries = Object.entries(descriptions).filter(([, v]) => v.trim());
  if (entries.length === 0) return {};

  const result: Record<string, string> = {};
  const batches: [string, string][][] = [];
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    batches.push(entries.slice(i, i + BATCH_SIZE));
  }

  console.log(`  🌐 Traduciendo ${entries.length} descripciones al inglés (${batches.length} lotes)...`);

  for (let i = 0; i < batches.length; i++) {
    process.stdout.write(`     Lote ${i + 1}/${batches.length}...`);
    const translated = await translateBatch(apiKey, batches[i]);
    Object.assign(result, translated);
    process.stdout.write(" ✓\n");
  }

  return result;
}
