---
name: verify
description: How to run and drive Bitedle locally to verify changes, including simulating signed Discord interactions without Discord.
---

# Verifying Bitedle changes locally

## Launch (isolated from production)

`.env.local` contains the REAL production `DATABASE_URL` — always blank it for
local runs so the dev server uses the JSON FileStore (`data/db.json`) instead
of the live Neon database:

```bash
DATABASE_URL= PORT=3111 npm run dev
```

`data/db.json` is gitignored; delete it after testing. Note the FileStore
caches the whole DB in memory at startup — editing `data/db.json` by hand
while the server runs has no effect and gets overwritten; restart the server
to make hand edits visible.

## Simulating Discord interactions

The interactions route verifies ed25519 signatures against
`DISCORD_PUBLIC_KEY`. Generate your own keypair, start the server with your
public key, and sign requests yourself — no Discord needed:

- keygen: `crypto.generateKeyPairSync("ed25519")`; the hex of the last 32
  bytes of the SPKI DER export is the "public key" env value.
- sign: hex of `crypto.sign(null, Buffer.from(timestamp + rawBody), privateKey)`,
  sent as `X-Signature-Ed25519` with `X-Signature-Timestamp`.
- POST to `http://localhost:3111/api/discord/interactions`.

Useful payloads (launch responds `{"type":12}`):

- Launch: `{"type":2,"data":{"name":"play"},"guild_id":"...","channel_id":"...","application_id":"...","token":"FAKE"}`
- Button: `{"type":3,"data":{"custom_id":"bitedle-launch"},...same fields}`

## Driving gameplay

Guild scoping comes from the `X-Bitedle-Guild-Id` header (only sent by the
real client inside Discord). Keep one cookie jar per simulated player:

```bash
curl -c cookies.txt -H "X-Bitedle-Guild-Id: <guild>" localhost:3111/api/state
curl -b cookies.txt -H "Content-Type: application/json" \
  -H "X-Bitedle-Guild-Id: <guild>" -d '{"index":7}' localhost:3111/api/click
```

## Observing Discord side effects

Outbound Discord webhook/bot calls run in `after()` callbacks — watch the dev
server log a few seconds after the triggering request. With fake interaction
tokens, Discord answers `401 {"message": "Invalid Webhook Token", "code": 50027}`,
which proves the render + multipart form + URL are correct end-to-end; a real
token is only mintable by a real Discord launch, so full delivery needs a
deployed build and a real server.
