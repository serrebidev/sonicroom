import { getOrCreateRoomNote } from "../../notes.js";
import type { ConnectionContext } from "../context.js";

// --- Shared room notes (NoteLab). One collaborative note per room, created on
// first request and reused by everyone for the room's lifetime (the URL lives on
// the Room). Configured via NOTELAB_URL; unset -> `notes_disabled`. See notes.ts. ---
export function registerNotesHandlers(ctx: ConnectionContext) {
  const { io, socket, session, helpers } = ctx;

  // Open (creating on first use) this room's shared note. The ack carries the
  // URL so the caller's client opens the tab; a fresh creation also broadcasts
  // `notes-updated` so everyone else's button flips to "open" and their next
  // Alt+N opens it straight away. The server is the single source of truth for
  // "does this room have a note yet", so no two people can ever create two.
  // MODERATED room: gated by its `notes` setting — and since the link IS the
  // access, the URL is only ever sent to peers who pass the same gate.
  socket.on("open-notes", async (_data: unknown, cb?: (res: unknown) => void) => {
    if (!session.currentRoom || !session.currentPeer)
      return cb?.({ ok: false, error: "Not in a room" });
    const room = session.currentRoom;
    if (!helpers.canOpenNotes(room, socket.id)) return cb?.({ ok: false, error: "forbidden" });
    try {
      const { url, created } = await getOrCreateRoomNote(room);
      if (created) {
        // Everyone else who may open it (the creator gets it on the ack).
        for (const id of room.peers.keys()) {
          if (id !== socket.id && helpers.canOpenNotes(room, id)) {
            io.to(id).emit("notes-updated", { url, by: session.currentPeer.displayName });
          }
        }
        console.log(
          `[ws] ${session.currentPeer.displayName} created shared notes for ${room.name}`,
        );
      }
      cb?.({ ok: true, url });
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      // notes_disabled (no NOTELAB_URL) vs any other failure (NoteLab down /
      // bad response / timeout) — the client announces a friendly message.
      cb?.({ ok: false, error: message === "notes_disabled" ? "notes_disabled" : "notes_failed" });
    }
  });
}
