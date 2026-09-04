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
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    if (payload) req.write(payload);
    req.end();
  });
}

function fmt(cents) {
  return "$" + (cents / 100).toFixed(2);
}

exports.handler = async function (event) {
  const headers = { "Content-Type": "application/json" };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  if (!TOKEN || !MID) return { statusCode: 500, headers, body: JSON.stringify({ error: "Credenciales de Clover no configuradas" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido" }) }; }

  const { items, customerName, tableNote, taxCents = 0, serviceFeeCents = 0, tipCents = 0, totalCents = 0, paymentIntentId } = body;

  if (!Array.isArray(items) || items.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Carrito vacío" }) };
  }

  // Build order note with full payment breakdown
  const noteLines = [];
  if (customerName) noteLines.push(`Cliente: ${customerName}`);
  if (tableNote) noteLines.push(tableNote);
  if (paymentIntentId) noteLines.push(`✅ PAGADO via Stripe: ${paymentIntentId}`);
  noteLines.push(`Subtotal: ${fmt(totalCents - taxCents - serviceFeeCents - tipCents)}`);
  noteLines.push(`Impuesto (8.25%): ${fmt(taxCents)}`);
  noteLines.push(`Servicio (4%): ${fmt(serviceFeeCents)}`);
  if (tipCents > 0) noteLines.push(`Propina: ${fmt(tipCents)}`);
  noteLines.push(`Total cobrado: ${fmt(totalCents)}`);

  try {
    // Fetch order types and tenders in parallel
    const [orderTypesRes, tendersRes] = await Promise.all([
      cloverFetch("GET", `/v3/merchants/${MID}/order_types`),
      cloverFetch("GET", `/v3/merchants/${MID}/tenders`),
    ]);

    // Find an online/pickup/delivery order type
    let orderTypeId = null;
    if (orderTypesRes.status === 200 && orderTypesRes.body?.elements) {
      const match = orderTypesRes.body.elements.find((t) =>
        /online|web|pickup|delivery|en\s*l[ií]nea/i.test(t.label || t.labelKey || "")
      );
      if (match) orderTypeId = match.id;
      else console.log("Order types available:", orderTypesRes.body.elements.map(t => `${t.id}:${t.label}`).join(", "));
    }

    // Find a tender suitable for external/card payments
    let tenderId = null;
    if (tendersRes.status === 200 && tendersRes.body?.elements) {
      const tenders = tendersRes.body.elements;
      // Prefer credit/card/custom/other; avoid cash
      const match =
        tenders.find((t) => /credit|card|tarjeta/i.test(t.label || "")) ||
        tenders.find((t) => /custom|other|otro|extern/i.test(t.label || "")) ||
        tenders.find((t) => !/cash|efectivo/i.test(t.label || "")) ||
        tenders[0];
      if (match) tenderId = match.id;
      console.log("Tenders available:", tenders.map(t => `${t.id}:${t.label}`).join(", "));
      console.log("Selected tender:", match?.label, match?.id);
    }

    // 1. Create order (with orderType if found)
    const orderPayload = {
      currency: "USD",
      state: "open",
      note: noteLines.join(" | "),
    };
    if (orderTypeId) orderPayload.orderType = { id: orderTypeId };

    const orderRes = await cloverFetch("POST", `/v3/merchants/${MID}/orders`, orderPayload);

    if (orderRes.status !== 200) {
      console.error("Clover order error:", orderRes.body);
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Error al crear la orden en Clover", detail: orderRes.body }) };
    }

    const orderId = orderRes.body.id;

    // 2. Add line items (one per quantity unit)
    for (const cartItem of items) {
      for (let q = 0; q < cartItem.quantity; q++) {
        const liRes = await cloverFetch("POST", `/v3/merchants/${MID}/orders/${orderId}/line_items`, {
          item: { id: cartItem.itemId },
          name: cartItem.name,
        });

        if (liRes.status !== 200) { console.error("Line item error:", liRes.body); continue; }

        const lineItemId = liRes.body.id;

        // 3. Add modifiers
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

    // 4. Register payment in Clover so order is marked as PAID → triggers auto-print
    if (tenderId && totalCents > 0) {
      const paymentPayload = {
        amount: totalCents,
        tipAmount: tipCents || 0,
        taxAmount: taxCents || 0,
        result: "SUCCESS",
        tender: { id: tenderId },
        order: { id: orderId },
      };
      if (paymentIntentId) paymentPayload.externalReferenceId = paymentIntentId;

      const payRes = await cloverFetch("POST", `/v3/merchants/${MID}/orders/${orderId}/payments`, paymentPayload);
      if (payRes.status !== 200) {
        console.error("Clover payment registration error:", payRes.body);
        // Non-fatal: order was created, Stripe payment processed
      } else {
        console.log("Clover payment registered:", payRes.body.id);
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ orderId, message: "Orden creada" }) };
  } catch (err) {
    console.error("Unexpected error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Error interno", detail: err.message }) };
  }
};
