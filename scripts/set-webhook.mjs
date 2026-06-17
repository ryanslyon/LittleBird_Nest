#!/usr/bin/env node
// Register (or delete) the Telegram webhook.
//
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_SECRET_TOKEN=... WEBHOOK_URL=https://nature-bot.<sub>.workers.dev/telegram/webhook \
//     node scripts/set-webhook.mjs
//
//   node scripts/set-webhook.mjs --delete       # remove the webhook
//   node scripts/set-webhook.mjs --info         # show current webhook info

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("ERROR: set TELEGRAM_BOT_TOKEN.");
  process.exit(1);
}
const API = `https://api.telegram.org/bot${token}`;

async function call(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

const arg = process.argv[2];

if (arg === "--info") {
  console.log(JSON.stringify(await call("getWebhookInfo"), null, 2));
} else if (arg === "--delete") {
  console.log(JSON.stringify(await call("deleteWebhook", { drop_pending_updates: true }), null, 2));
} else {
  const url = process.env.WEBHOOK_URL;
  const secret = process.env.TELEGRAM_SECRET_TOKEN;
  if (!url || !secret) {
    console.error("ERROR: set WEBHOOK_URL and TELEGRAM_SECRET_TOKEN.");
    process.exit(1);
  }
  const result = await call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  console.log(JSON.stringify(result, null, 2));
}
