const https = require("https");

const TOKEN = process.env.CLOVER_API_TOKEN;
const MID = process.env.CLOVER_MERCHANT_ID;
const REGION = process.env.CLOVER_REGION || "us";
const BASE = REGION === "eu" ? "api.eu.clover.com" : "api.clover.com";

function cloverFetch(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: BASE,
        path,
        method,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
        timeout: 15000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    if (payload) req.write(payload);
    req.end();
  });
}

exports.handler = async function (event) {
  const headers = { "Content-Type": "application/json" };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido" }) };
  }

  const { items, tableNote } = body;

  if (!Array.isArray(items) || items.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Carrito vacío" }) };
  }

  if (!TOKEN || !MID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Credenciales de Clover no configuradas" }) };
  }

  try {
    // 1. Crear la orden
    const orderRes = await cloverFetch("POST", `/v3/merchants/${MID}/orders`, {
      currency: "USD",
      state: "open",
      ...(tableNote ? { note: tableNote } : {}),
    });

    if (orderRes.status !== 200) {
      console.error("Clover order error:", orderRes.body);
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Error al crear la orden en Clover", detail: orderRes.body }) };
    }

    const orderId = orderRes.body.id;

    // 2. Agregar líneas (una por unidad de cantidad)
    for (const cartItem of items) {
      for (let q = 0; q < cartItem.quantity; q++) {
        const liRes = await cloverFetch("POST", `/v3/merchants/${MID}/orders/${orderId}/line_items`, {
          item: { id: cartItem.itemId },
          name: cartItem.name,
        });

        if (liRes.status !== 200) {
          console.error("Line item error:", liRes.body);
          continue;
        }

        const lineItemId = liRes.body.id;

        // 3. Agregar modificadores
        for (const mod of cartItem.modifiers || []) {
          if (!mod.id) continue;
          await cloverFetch("POST", `/v3/merchants/${MID}/orders/${orderId}/line_items/${lineItemId}/modifications`, {
            modifier: { id: mod.id },
            name: mod.name,
            amount: mod.price,
          });
        }
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ orderId, message: "Orden enviada al POS" }) };
  } catch (err) {
    console.error("Unexpected error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Error interno", detail: err.message }) };
  }
};
