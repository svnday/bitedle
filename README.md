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

### Slash commands: `/play`, `/bitedle`, and `/share`

`/play` and `/bitedle` both launch the Activity — they're intentionally
redundant names for the same action. `/share` posts a result. Two different
mechanisms are involved:

- **`/play`** is Discord's **entry point command** — enabling Activities
  auto-creates a default one named "Launch" (type `PRIMARY_ENTRY_POINT`).
  There's no Developer Portal field to rename it, so
  [scripts/set-entry-point-command.mjs](scripts/set-entry-point-command.mjs)
  does it via Discord's API, renaming it to `/play` **and** switching its
  handler from `DISCORD_LAUNCH_ACTIVITY` (2) to **`APP_HANDLER` (1)**. With
  the default handler, Discord auto-posts a public "Game Invitation" card on
  *every* launch — spammy. With `APP_HANDLER`, the launch interaction reaches
  [src/app/api/discord/interactions/route.ts](src/app/api/discord/interactions/route.ts)
  instead, which launches the Activity (response type `12`, `LAUNCH_ACTIVITY`)
  and posts a **throttled channel-stats preview** rather than a card on every
  launch (see below). An app can only have **one** entry point command, so
  this mechanism can't be reused for a second name.
- **`/bitedle`** is an ordinary `CHAT_INPUT` command (registered by
  [scripts/register-discord-commands.mjs](scripts/register-discord-commands.mjs))
  that gets the same result a different way: the same interactions route
  replies with interaction response type `12` (`LAUNCH_ACTIVITY`) to launch
  the Activity, and likewise posts the throttled preview.
- **`/share`** posts that player's already-finished result for today's
  puzzle (same non-spoiling text as the site's own Share button), publicly
  in the channel. Also an ordinary `CHAT_INPUT` command handled by the same
  interactions route — it looks the caller up by their linked Discord id (a
  player must have opened `/play` or `/bitedle` at least once for that link
  to exist, since that's when Discord identity gets linked) and their game
  for today.

**Throttled launch preview.** Instead of Discord's per-launch invitation
card, launching via `/play` or `/bitedle` posts a channel-stats preview image
(the same render as the daily summary) to the channel — but at most **once
per hour per server** (`PREVIEW_COOLDOWN_MS` in the interactions route), and
only once someone has actually finished today's puzzle. The image render and
post run in a Next.js [`after()`](https://nextjs.org/docs/app/api-reference/functions/after)
callback so they never delay the launch response past Discord's 3-second
window. The one-hour cooldown lives in a `last_preview_at` column on the
`guild_channels` table.

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

### Making Bitedle installable in any server

Discord has two independent install models, and Bitedle supports both:

- **Guild install** — a server admin adds Bitedle; the **bot joins** the
  server. This is required for the [daily results summary](#daily-results-summary)
  to post (the bot has to be a member to send a channel message).
- **User install** — an individual adds Bitedle to their own account and can
  then launch the Activity in **any** server, even one that hasn't added the
  app. The bot is **not** a member of those servers, so the daily summary
  can't post there — but the Activity, avatars, per-server leaderboards, and
  `/share` all work fine.

If the app only supports guild install, opening it from the Activities
button in a server that hasn't added it fails with *"Your app has enabled
Activities but has no commands registered to launch them."* Enabling user
install fixes that.

Setup (**do the portal step first** — Discord rejects `integration_type 1`
on a command if the app itself doesn't support user install yet):

1. Developer Portal → **Installation** tab → **Installation Contexts**:
   enable **both** Guild Install and User Install.
2. **Install Link** → "Discord Provided Link" (a shareable link people use to
   add Bitedle to their server or account).
3. **Default Install Settings**:
   - Guild Install → scopes `applications.commands` + `bot`; bot permissions
     **View Channels, Send Messages, Attach Files** (for the daily summary).
   - User Install → scope `applications.commands`.
4. Developer Portal → **Bot** tab → turn **Public Bot** on so anyone with the
   link can add it.
5. Re-run both command scripts above. They now register the entry point
   command and `/bitedle` / `/share` with `integration_types [0, 1]` and
   `contexts [0, 1, 2]`, making them available in both install models.
   Confirm with `node scripts/list-discord-commands.mjs` — the entry point
   command should show `integration_types` `[0, 1]`.

### Daily results summary

Once a day, Bitedle automatically posts a recap into each Discord server
that's using it: a plain caption plus a generated image showing every
player who's finished that day's puzzle in that server, with their Discord
avatar, name, and a non-spoiling result trail (misses + win/loss — never
real board positions, same as the site's own Share button). No @mentions,
no streak stat — just the caption and the image.

This is handled by a [Vercel Cron Job](https://vercel.com/docs/cron-jobs)
([vercel.json](vercel.json)) that hits
[src/app/api/cron/daily-summary/route.tsx](src/app/api/cron/daily-summary/route.tsx)
once a day at `20:00 UTC` — approximately 8 hours before the daily reset:
exactly 8 hours before midnight in `America/New_York` while daylight saving
is in effect (most of the year), drifting to about 9 hours during the
winter months, since Vercel Cron schedules are fixed UTC times and don't
shift for DST. It loops over every server independently, so one server
having no finished games yet (or a Discord error) simply skips that server
without affecting any others.

**Works across any number of servers with no manual setup** — there's no
admin command to run and nothing to configure per server. The target
channel is auto-detected: the first time anyone runs `/bitedle` or `/share`
in a server, [the interactions route](src/app/api/discord/interactions/route.ts)
records that channel as the one to post that server's summary into
(reading `channel_id` off Discord's own interaction payload), and keeps it
up to date on every later use. The one gap: a server that only ever uses
`/play` (Discord's native entry-point command, which our backend never
receives an interaction for at all) won't have a channel registered yet —
running `/bitedle` or `/share` once fixes that.

Two things still need setting up (see [.env.example](.env.example)):

- `DISCORD_BOT_TOKEN` — same value as used for the admin scripts above, but
  this is the first feature where the *deployed app* also needs it as a
  real Vercel environment variable (to actually post messages, not just for
  local one-off scripts). The bot needs **View Channel**, **Send
  Messages**, and **Attach Files** permissions in whatever channel ends up
  auto-detected (a common gotcha even when the bot already has broad server
  permissions, since channels can have their own permission overwrites).
- `CRON_SECRET` — any long random string. Vercel automatically sends this
  back as `Authorization: Bearer <value>` on requests it makes to trigger
  the cron job, which the route checks to reject any other caller.

