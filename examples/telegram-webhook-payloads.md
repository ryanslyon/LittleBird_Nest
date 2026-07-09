# Sample Telegram webhook payloads

Use these with `wrangler dev` to simulate updates without a live Telegram
webhook. The secret token must match `.dev.vars`.

## Text message

```bash
curl -X POST http://127.0.0.1:8787/telegram/webhook \
  -H 'content-type: application/json' \
  -H 'x-telegram-bot-api-secret-token: <TELEGRAM_SECRET_TOKEN>' \
  -d '{
    "update_id": 1,
    "message": {
      "message_id": 1,
      "chat": { "id": <YOUR_CHAT_ID> },
      "text": "What is a tardigrade?"
    }
  }'
```

## Location pin

```bash
curl -X POST http://127.0.0.1:8787/telegram/webhook \
  -H 'content-type: application/json' \
  -H 'x-telegram-bot-api-secret-token: <TELEGRAM_SECRET_TOKEN>' \
  -d '{
    "update_id": 2,
    "message": {
      "message_id": 2,
      "chat": { "id": <YOUR_CHAT_ID> },
      "location": { "latitude": 40.4443, "longitude": -79.9427 }
    }
  }'
```

## Starting/ending a journey

```bash
curl -X POST http://127.0.0.1:8787/telegram/webhook \
  -H 'content-type: application/json' \
  -H 'x-telegram-bot-api-secret-token: <TELEGRAM_SECRET_TOKEN>' \
  -d '{
    "update_id": 3,
    "message": {
      "message_id": 3,
      "chat": { "id": <YOUR_CHAT_ID> },
      "text": "Starting a walk around Schenley Park"
    }
  }'
```

To receive replies on Telegram during local dev, use a real `chat.id`
(message the bot once and read it from
`https://api.telegram.org/bot<token>/getUpdates`, with the webhook unset) and
expose `wrangler dev` over a tunnel.
