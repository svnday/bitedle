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
        player.
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
        stats, streaks, and leaderboards work. That&apos;s the entirety of what Bitedle stores.
      </p>

      <h2 className="mt-8 mb-2 font-bold">No tracking, no ads</h2>
      <p className="text-muted mb-3 leading-relaxed">
        Bitedle does not use analytics, advertising, or third-party tracking scripts.
      </p>

      <h2 className="mt-8 mb-2 font-bold">Playing inside Discord</h2>
      <p className="text-muted mb-3 leading-relaxed">
        If you play Bitedle through Discord (as an Activity), Discord itself may collect data about
        that session under its own privacy policy, separate from and outside of Bitedle&apos;s
        control.
      </p>

      <h2 className="mt-8 mb-2 font-bold">Deleting your data</h2>
      <p className="text-muted mb-3 leading-relaxed">
        To request deletion or anonymization of your data, contact{" "}
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
