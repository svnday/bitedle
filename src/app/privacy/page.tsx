import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy · Bitedle",
};

export default function PrivacyPage() {
  return (
    <main className="text-foreground mx-auto max-w-2xl px-4 py-12">
      <Link href="/" className="text-muted hover:text-foreground text-sm">
        ← Back to Bitedle
      </Link>
      <h1 className="mt-6 mb-6 text-2xl font-bold">Privacy Policy</h1>
      <p className="text-muted mb-3 leading-relaxed">Last updated: July 7, 2026</p>

      <p className="text-muted mb-3 leading-relaxed">
        Bitedle is built to collect as little as possible. Here&apos;s exactly what happens with
        your data.
      </p>

      <h2 className="mt-8 mb-2 font-bold">No accounts</h2>
      <p className="text-muted mb-3 leading-relaxed">
        There is no sign-up, no password, and no email collected to play. The first time you
        visit, the server assigns your browser a random, anonymous identifier stored in a cookie
        (<code>bitedle_id</code>). That cookie — not your name, email, or any other personal
        detail — is how Bitedle recognizes you as a returning player. It lasts about a year, and
        clearing your cookies or switching browsers simply starts you over as a new anonymous
        player. When Bitedle is played through Discord, an additional step described below links
        your Discord identity to this same cookie.
      </p>

      <h2 className="mt-8 mb-2 font-bold">Display name</h2>
      <p className="text-muted mb-3 leading-relaxed">
        After your first game, you can optionally type a display name to appear on the
        leaderboards. This is free text you choose yourself — Bitedle doesn&apos;t verify it&apos;s
        a real name, and you can change it anytime. If you skip it, your results simply aren&apos;t
        shown on the leaderboards.
      </p>

      <h2 className="mt-8 mb-2 font-bold">What&apos;s stored</h2>
      <p className="text-muted mb-3 leading-relaxed">
        Your anonymous ID, your display name (if set), and your daily game results (which cells you
        clicked and whether you won or lost) are stored in a database (Neon/Postgres) so that
        stats, streaks, and leaderboards work. If you play through Discord, this may also include
        your Discord user ID, a reference to your Discord avatar image, and which Discord server a
        given game was played in (see &quot;Playing inside Discord&quot; below). That&apos;s the
        entirety of what Bitedle stores.
      </p>

      <h2 className="mt-8 mb-2 font-bold">No tracking, no ads</h2>
      <p className="text-muted mb-3 leading-relaxed">
        Bitedle does not use analytics, advertising, or third-party tracking scripts.
      </p>

      <h2 className="mt-8 mb-2 font-bold">Playing inside Discord</h2>
      <p className="text-muted mb-3 leading-relaxed">
        If you play Bitedle through Discord (as an Activity) and grant Discord&apos;s
        &quot;identify&quot; permission when prompted, Bitedle asks Discord for your Discord user
        ID and a reference to your avatar image. Both are stored linked to your existing anonymous
        Bitedle ID, solely so your real Discord avatar can be shown next to your name on the
        leaderboard <em>inside that Discord server</em>. This never happens on the public website
        (bitedle.vercel.app), and Bitedle never posts anything back to Discord or to any channel —
        the only use is displaying your avatar within Bitedle&apos;s own leaderboard.
      </p>
      <p className="text-muted mb-3 leading-relaxed">
        Games played through a specific Discord server are also tagged with that server&apos;s ID,
        so the leaderboard shown inside a server only ever includes players and games from that
        same server — never the public website&apos;s leaderboard, and never another server&apos;s.
        The public website leaderboard only ever shows games played directly on the website.
      </p>
      <p className="text-muted mb-3 leading-relaxed">
        Separately, and outside Bitedle&apos;s control, Discord itself may collect its own data
        about your Activity session under Discord&apos;s own privacy policy.
      </p>

      <h2 className="mt-8 mb-2 font-bold">Deleting your data</h2>
      <p className="text-muted mb-3 leading-relaxed">
        To request deletion or anonymization of your data — including any linked Discord identity
        — contact{" "}
        <a href="mailto:sumadef@gmail.com" className="text-foreground underline">
          sumadef@gmail.com
        </a>
        . There isn&apos;t an automated self-service deletion tool yet, so requests are handled
        manually — please include enough detail (like your display name) for us to find your data.
      </p>

      <h2 className="mt-8 mb-2 font-bold">Contact</h2>
      <p className="text-muted mb-3 leading-relaxed">
        Questions about this policy? Reach out at{" "}
        <a href="mailto:sumadef@gmail.com" className="text-foreground underline">
          sumadef@gmail.com
        </a>
        .
      </p>

      <Link href="/" className="text-muted hover:text-foreground mt-8 inline-block text-sm">
        ← Back to Bitedle
      </Link>
    </main>
  );
}
