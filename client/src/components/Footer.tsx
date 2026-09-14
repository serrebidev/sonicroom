import { Headphones, BookOpen } from "lucide-react";
import { useRoomStore } from "../stores/room";
import { m } from "../paraglide/messages.js";

const REPO_URL = "https://github.com/ogomez92/sonicroom";

// The "Powered by SonicRoom" attribution link (no landmark element on its own).
// Reused both inside the standalone-page Footer below and inside the room's
// existing controls footer, so the active call doesn't gain a second
// `contentinfo` landmark.
export function PoweredBy() {
  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs text-sonic-400 transition-colors hover:text-sonic-accent focus-visible:text-sonic-accent focus-visible:outline-none"
    >
      <Headphones className="h-3.5 w-3.5" aria-hidden="true" />
      {m.footer_powered_by()}
    </a>
  );
}

// Link to the screen-reader manual for the language the UI is currently in
// (docs/manual/<locale>.md, rendered to client/public/manual/<locale>.html by
// docs/manual/build.sh and therefore served straight out of client/dist).
// Subscribed to the store's `locale` so a mid-session language switch re-points
// it in place, like every other localized string.
export function ManualLink() {
  const locale = useRoomStore((s) => s.locale);
  return (
    <a
      href={`/manual/${locale}.html`}
      target="_blank"
      rel="noopener noreferrer"
      title={m.footer_manual_title()}
      className="inline-flex items-center gap-1.5 text-xs text-sonic-400 transition-colors hover:text-sonic-accent focus-visible:text-sonic-accent focus-visible:outline-none"
    >
      <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
      {m.footer_manual()}
    </a>
  );
}

// The two footer links, used both by the standalone Footer below and by the
// room's own controls footer (which must keep exactly one `contentinfo`).
export function FooterLinks() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
      <PoweredBy />
      <ManualLink />
    </div>
  );
}

// Page footer (a `contentinfo` landmark) for the standalone screens — the lobby
// and the room's connecting/error states, none of which have another footer.
export function Footer() {
  return (
    <footer className="flex justify-center border-t border-sonic-700 px-6 py-3">
      <FooterLinks />
    </footer>
  );
}
