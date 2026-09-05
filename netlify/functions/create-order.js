const https = require("https");

const TOKEN = process.env.CLOVER_API_TOKEN;
const MID = process.env.CLOVER_MERCHANT_ID;
const REGION = process.env.CLOVER_REGION || "us";
const BASE = REGION === "eu" ? "api.eu.clover.com" : "api.clover.com";

const TAX_RATE = 0.0825;
const SERVICE_RATE = 0.04;

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

  let { items, customerName, tableNote, taxCents = 0, serviceFeeCents = 0, tipCents = 0, totalCents = 0, paymentIntentId } = body;

  // If frontend didn't send totals, calculate from items (fallback)
  if (totalCents === 0 && Array.isArray(items) && items.length > 0) {
    const subCents = items.reduce((s, i) => s + (i.unitTotal || i.price || 0) * (i.quantity || 1), 0);
    taxCents = Math.round(subCents * TAX_RATE);
    serviceFeeCents = Math.round(subCents * SERVICE_RATE);
    totalCents = subCents + taxCents + serviceFeeCents + (tipCents || 0);
    console.log(`[calc] recalculated: sub=${subCents} tax=${taxCents} service=${serviceFeeCents} total=${totalCents}`);
  }

  console.log(`[recv] totalCents=${totalCents} taxCents=${taxCents} serviceFeeCents=${serviceFeeCents} tipCents=${tipCents} items=${Array.isArray(items) ? items.length : 'none'}`);

  if (!Array.isArray(items) || items.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Carrito vacío" }) };
  }

  // Build order note with full payment breakdown
  const subTotal = totalCents - taxCents - serviceFeeCents - (tipCents || 0);
  const noteLines = [];
  if (customerName) noteLines.push(`Cliente: ${customerName}`);
  if (tableNote) noteLines.push(tableNote);
  if (paymentIntentId) noteLines.push(`✅ PAGADO via Stripe: ${paymentIntentId}`);
  noteLines.push(`Subtotal: ${fmt(subTotal)}`);
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

    // Find "Stripe" order type first, then any online/pickup/delivery type
    let orderTypeId = null;
    const otElements = orderTypesRes.body?.elements || [];
    if (otElements.length > 0) {
      const match =
        otElements.find((t) => /^stripe$/i.test(t.label || t.labelKey || "")) ||
        otElements.find((t) => /online|web|pickup|delivery/i.test(t.label || t.labelKey || ""));
      orderTypeId = match ? match.id : null;
      console.log(`[order_types] selected=${match ? match.label || match.labelKey : 'none'} id=${orderTypeId}`);
    }

    // Find "External Payment" tender — Clover rejects native credit/debit via API
    let tenderId = null;
    const tElements = tendersRes.body?.elements || [];
    if (tElements.length > 0) {
      const match =
        tElements.find((t) => /external\s*payment/i.test(t.label || t.labelKey || "")) ||
        tElements.find((t) => /external/i.test(t.label || t.labelKey || "")) ||
        tElements.find((t) => /custom|other|otro/i.test(t.label || t.labelKey || "")) ||
        tElements.find((t) => !/cash|efectivo|credit|debit|check|gift|levelup/i.test(t.label || t.labelKey || "")) ||
        tElements[0];
      if (match) tenderId = match.id;
      console.log(`[tenders] selected=${match ? match.label || match.labelKey : 'none'} id=${tenderId}`);
    }

    // 1. Create order
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

    // 4. Register payment with External Payment tender → marks order as PAID → triggers auto-print
    if (tenderId) {
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
      console.log(`[payment] status=${payRes.status} body=${JSON.stringify(payRes.body)}`);
    } else {
      console.log(`[payment] skipped — no tenderId found`);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ orderId, message: "Orden creada" }) };
  } catch (err) {
    console.error("Unexpected error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Error interno", detail: err.message }) };
  }
};
