import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service · Bitedle",
};

export default function TermsPage() {
  return (
    <main className="text-foreground mx-auto max-w-2xl px-4 py-12">
      <Link href="/" className="text-muted hover:text-foreground text-sm">
        ← Back to Bitedle
      </Link>
      <h1 className="mt-6 mb-6 text-2xl font-bold">Terms of Service</h1>
      <p className="text-muted mb-3 leading-relaxed">Last updated: July 7, 2026</p>

      <p className="text-muted mb-3 leading-relaxed">
        Bitedle is a free daily puzzle game. There are no accounts to create, nothing to buy, and
        no subscriptions — you just play. By using Bitedle, you agree to these terms.
      </p>

      <h2 className="mt-8 mb-2 font-bold">The game</h2>
      <p className="text-muted mb-3 leading-relaxed">
        Each day there is one shared board, and each player gets one attempt at it. Please play
        fair — don&apos;t use automation, multiple identities, or other means to get extra
        attempts or to manipulate the leaderboards.
      </p>

      <h2 className="mt-8 mb-2 font-bold">No age verification</h2>
      <p className="text-muted mb-3 leading-relaxed">
        Bitedle does not currently verify the age of players. If you are a parent or guardian and
        believe a child has used the service inappropriately, please contact us using the details
        below.
      </p>

      <h2 className="mt-8 mb-2 font-bold">As-is, no warranty</h2>
      <p className="text-muted mb-3 leading-relaxed">
        Bitedle is provided &quot;as is,&quot; with no guarantee of uptime or that it will always
        be free of bugs. It&apos;s a small, independently run project, not a commercial product
        backed by a support team.
      </p>

      <h2 className="mt-8 mb-2 font-bold">Changes</h2>
      <p className="text-muted mb-3 leading-relaxed">
        The game, these terms, and the service as a whole may change or be discontinued at any
        time. Meaningful changes to these terms will update the date above.
      </p>

      <h2 className="mt-8 mb-2 font-bold">Contact</h2>
      <p className="text-muted mb-3 leading-relaxed">
        Questions about these terms? Reach out at{" "}
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
