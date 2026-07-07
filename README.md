# Bitedle 💣✓

A daily game of nerve, Wordle-style. Somewhere on a 5×5 board hides **one green
check mark** — find it in as few clicks as you can. But 3 to 5 **bombs** are
hiding too, and one wrong click ends your day.

## Rules

- Click a tile to reveal it:
  - **✗ (red X)** — a safe miss, keep going.
  - **💣 (bomb)** — game over, counts as a loss.
  - **✓ (check mark)** — you win!
- Your score is the number of clicks it took to find the check. Lower is
  better; 1 is perfection.
- There is exactly **one** check mark and **3–5 bombs** (the exact count is
  hidden) — every other tile is a miss.
- A new board is generated every day at midnight. Everyone plays the **same
  board**, and each player gets **one game per day**.
- No sign-in: play immediately, and after your first game pick a display
  name for the leaderboard (rename anytime from the header chip). Skipping
  the name keeps your results **off the leaderboards** until you pick one —
  personal stats still work. Everything follows you via an anonymous browser
  cookie.

## Running it

```bash
npm install
npm run dev        # development, http://localhost:3000
```

or for production:

```bash
npm run build
npm start
```

## How it works

- **Next.js 16 (App Router) + TypeScript + Tailwind CSS 4.**
- The daily board is derived from a **secret + the date**
  ([src/lib/game.ts](src/lib/game.ts)), and the API only reveals the cells you
  have clicked — so the layout can't be peeked at from the client. The secret
  comes from the `BITEDLE_SECRET` env var (a fixed dev value is used locally).
- The day flips at **midnight in `BITEDLE_TZ`** (default `America/New_York`)
  for everyone, regardless of where the player or server is
  ([src/lib/time.ts](src/lib/time.ts)); the API tells the client exactly when
  the next board drops.
- Storage is behind a small interface ([src/lib/store.ts](src/lib/store.ts)):
  **Neon/Postgres** when `DATABASE_URL` is set (tables are auto-created on
  first request), otherwise a local JSON file at `data/db.json` for
  zero-setup development.
- API routes ([src/app/api/](src/app/api/)): `state`, `click`, `name`,
  `stats`, `leaderboard`. Identity is an anonymous id in an httpOnly cookie,
  auto-created on first visit ([src/lib/identity.ts](src/lib/identity.ts));
  the display name is just a label, so duplicates are allowed and the
  leaderboard marks your own rows server-side. Clearing cookies (or switching
  browsers) starts a fresh player — streaks don't follow you across devices.

## Discord Activity setup

Bitedle can run embedded in Discord as an Activity — an iframe loaded through
Discord's own reverse proxy. The code side is already handled
([src/components/DiscordBootstrap.tsx](src/components/DiscordBootstrap.tsx),
the `/.proxy`-aware fetch helper in
[src/lib/client-api.ts](src/lib/client-api.ts), and the iframe-friendly cookie
and CSP settings in [src/lib/identity.ts](src/lib/identity.ts) and
[next.config.ts](next.config.ts)) — but a few steps only exist in the Discord
Developer Portal and can't be done from this repo:

1. Create an Application at the [Discord Developer Portal](https://discord.com/developers/applications) and enable **Activities** for it.
2. Under **Activities → URL Mappings**, add the root mapping — PREFIX `/`, TARGET `bitedle.vercel.app`. (The win/lose GIFs are self-hosted, so no extra mapping is needed for them.)
3. Under **General Information**, set:
   - Terms of Service URL: `https://bitedle.vercel.app/terms`
   - Privacy Policy URL: `https://bitedle.vercel.app/privacy`

   (Discord requires both for any public Application; they only resolve once this app is deployed with the `/terms` and `/privacy` pages.)
4. Copy the Application's **Client ID** into the `NEXT_PUBLIC_DISCORD_CLIENT_ID` environment variable (see [.env.example](.env.example)) — in Vercel's project settings for production.
5. (Optional, for Discord avatars) Under **OAuth2**, copy the **Client Secret** into `DISCORD_CLIENT_SECRET` — a real secret, unlike the client ID, so never expose it to the browser or commit it. The redirect URI needed for `authorize()` to work is a placeholder (`https://127.0.0.1`) added under the same OAuth2 tab; the Embedded App SDK handles the real redirect itself, so the URL doesn't need to resolve to anything.

Normal web play at `bitedle.vercel.app` is unaffected either way: the Discord
SDK only loads, and the `/.proxy` prefix only applies, when the app detects
it's running inside a `*.discordsays.com` iframe.

When played through Discord, Bitedle also silently asks for the `identify`
OAuth scope so it can show each player's real Discord avatar on the
leaderboard ([src/components/DiscordBootstrap.tsx](src/components/DiscordBootstrap.tsx),
[src/app/api/discord/](src/app/api/discord/)) — this never happens on the
public website. Leaderboards are also scoped per Discord server: a game
played inside one server only ever shows up on that server's leaderboard,
never on the public website's, and never on another server's
([src/lib/discord.ts](src/lib/discord.ts)).

### Slash commands: `/play` and `/share`

Two commands, two different mechanisms:

- **`/play`** launches the Activity inline, visible to everyone in the
  channel. This is Discord's **entry point command** — enabling Activities
  auto-creates a default one named "Launch" (type `PRIMARY_ENTRY_POINT`,
  handled entirely by Discord's own servers via `DISCORD_LAUNCH_ACTIVITY`;
  no code on this backend runs). There's no Developer Portal field to rename
  it, so [scripts/set-entry-point-command.mjs](scripts/set-entry-point-command.mjs)
  does it via Discord's API instead, renaming it to `/play`.
- **`/share`** posts that player's already-finished result for today's
  puzzle (same non-spoiling text as the site's own Share button), publicly
  in the channel. Unlike `/play`, this is an ordinary `CHAT_INPUT` command
  that Discord forwards to Bitedle's own backend —
  [scripts/register-discord-commands.mjs](scripts/register-discord-commands.mjs)
  registers it, and [src/app/api/discord/interactions/route.ts](src/app/api/discord/interactions/route.ts)
  handles it, looking the caller up by their linked Discord id (see
  "avatar-linking" below — a player must have opened `/play` at least once
  for that link to exist) and their game for today.

Run both scripts locally (not from Vercel — one-time admin actions, not
part of the deployed app):

```bash
DISCORD_CLIENT_ID=... DISCORD_BOT_TOKEN=... node scripts/set-entry-point-command.mjs
DISCORD_CLIENT_ID=... DISCORD_BOT_TOKEN=... node scripts/register-discord-commands.mjs
```

(Order doesn't matter — `register-discord-commands.mjs` also cleans up a
stray ordinary `/play` command left over from before `/play` became the
entry point command's name.) Optionally add `DISCORD_GUILD_ID=...` to the
second command so it appears in one server immediately instead of waiting
for global propagation.

- `DISCORD_CLIENT_ID` is the same value as `NEXT_PUBLIC_DISCORD_CLIENT_ID`.
- `DISCORD_BOT_TOKEN` comes from the Developer Portal's **Bot** tab (Reset
  Token / Copy). Unlike the client ID, this is a real secret — never commit
  it, never prefix it `NEXT_PUBLIC_`, and only pass it as a one-off
  environment variable in your own terminal.

`register-discord-commands.mjs` also prints an install URL using Discord's
`applications.commands` scope. Open that URL and add the app to the server
so the slash commands are actually exposed there — a `bot`-scope-only
invite is not enough; **no slash command (including `/play`) shows up in a
server unless the app was added there with the `applications.commands`
scope**.

Then, in the Developer Portal's **General Information** tab, set the
Interactions Endpoint URL to:

```text
https://<your-domain>/api/discord/interactions
```

Discord immediately sends a signed test request to that URL and refuses to
save it unless the response proves it came from a verified Discord request
— [src/app/api/discord/interactions/route.ts](src/app/api/discord/interactions/route.ts)
checks this using `DISCORD_PUBLIC_KEY` (the **Public Key** field on that
same General Information page; see [.env.example](.env.example)). Set that
env var (in Vercel too) *before* trying to save the Interactions Endpoint
URL, or the Portal will reject it. Both scripts are safe to re-run any time.

