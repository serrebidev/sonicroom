import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  readFileSync,
  statSync,
  writeFileSync,
  renameSync,
  chmodSync,
  chownSync,
  mkdirSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { moderationPolicySchema, type ModerationPolicy } from "./moderation-util.js";

// Room RESERVATIONS: "this room name belongs to a host".
//
// Rooms are ephemeral and created by whoever joins first, so a link advertised
// ahead of time ("we'll meet in /room/studio on Friday, it'll be moderated")
// can be squatted: someone opens it early and becomes the room's creator — and
// its admin, with a policy of their choosing — or the host's moderated room
// simply evaporates the moment it empties. A reservation fixes both:
//
//   * a reserved name can only be OPENED (created from empty) by someone
//     presenting the reservation's host key; anyone else who arrives early is
//     refused with `reserved` and waits for the host (the client polls
//     /api/rooms/:name and joins by itself once the room is live);
//   * the room's moderation policy comes from the reservation, not from the
//     joiner, and a reserved room STAYS moderated even after its last admin
//     leaves (the host can come back as admin with the key at any time);
//   * presenting the host key on any join makes that peer an admin.
//
// The store is a small JSON file (RESERVATIONS_FILE, default
// <repo>/data/reservations.json — gitignored, and outside client/dist so it is
// never served) written by the operator's CLI (`pnpm reserve …`,
// server/scripts/reserve.ts) or the password-gated admin UI (/admin, admin.ts),
// and READ by the join handler through ReservationStore. Reserving is
// operator-only on purpose (no public HTTP surface for squatting names). The
// file is re-read whenever its mtime/size changes, so a new reservation needs
// no restart. Host keys are random 192-bit tokens (never typed by a human), so
// SHA-256 at rest is enough; verification is constant-time on the digests.
// Under the systemd unit (ProtectSystem=strict) the data/ directory is the one
// writable path in the tree (ReadWritePaths=/home/sonicroom/data).
//
// Everything here except ReservationStore's file access is pure and unit-tested.

export const reservationSchema = z.object({
  // sha256 hex of the host key.
  hostKeyHash: z.string().regex(/^[0-9a-f]{64}$/),
  // The moderation policy the room is opened with (the lobby's fieldset is
  // ignored for a reserved room). Defaults fill in whatever the file omits.
  moderation: moderationPolicySchema.default({}),
  createdAt: z.string().datetime().optional(),
  // ISO timestamp after which the reservation is ignored (the name is free
  // again); null/absent = never expires.
  expiresAt: z.string().datetime().nullable().optional(),
  // Free-form operator note ("Ana's Friday show"), never sent to clients.
  note: z.string().max(200).optional(),
});
export type Reservation = z.infer<typeof reservationSchema>;

export const reservationsFileSchema = z.object({
  version: z.literal(1),
  // Keyed by canonical (lowercase) room name.
  rooms: z.record(z.string(), reservationSchema),
});
export type ReservationsFile = z.infer<typeof reservationsFileSchema>;

export const EMPTY_RESERVATIONS: ReservationsFile = { version: 1, rooms: {} };

export function hashHostKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

// 192 random bits, base64url (32 chars) — safe in a URL query string.
export function generateHostKey(): string {
  return randomBytes(24).toString("base64url");
}

export function verifyHostKey(reservation: Reservation, key: string | null | undefined): boolean {
  if (!key) return false;
  const a = Buffer.from(hashHostKey(key), "hex");
  const b = Buffer.from(reservation.hostKeyHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isExpired(reservation: Reservation, now: number): boolean {
  if (!reservation.expiresAt) return false;
  const t = Date.parse(reservation.expiresAt);
  return Number.isFinite(t) && t <= now;
}

// Parse the file's text. A malformed file yields an EMPTY store (plus the
// error, so the caller can log it) rather than throwing: a typo in the
// operator's JSON must not take every room down with it — the worst case is
// "reservations are off until the file is fixed", which the startup/reload
// log line makes visible.
export function parseReservationsFile(text: string): {
  file: ReservationsFile;
  error: string | null;
} {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { file: EMPTY_RESERVATIONS, error: `invalid JSON: ${(err as Error).message}` };
  }
  const parsed = reservationsFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      file: EMPTY_RESERVATIONS,
      error: `invalid reservations file: ${issue?.path.join(".") || "(root)"}: ${issue?.message}`,
    };
  }
  // Normalize the keys to the canonical lowercase room name so a hand-edited
  // "Studio" still matches the room the server keys as "studio".
  const rooms: Record<string, Reservation> = {};
  for (const [name, r] of Object.entries(parsed.data.rooms)) rooms[name.toLowerCase()] = r;
  return { file: { version: 1, rooms }, error: null };
}

// The live reservation for `name`, or null if there is none or it has expired.
export function findReservation(
  file: ReservationsFile,
  name: string,
  now: number,
): Reservation | null {
  const r = file.rooms[name.toLowerCase()];
  if (!r || isExpired(r, now)) return null;
  return r;
}

// --- CLI helpers (pure; the script in scripts/reserve.ts does the I/O) ---

export function upsertReservation(
  file: ReservationsFile,
  name: string,
  reservation: Reservation,
): ReservationsFile {
  return { version: 1, rooms: { ...file.rooms, [name.toLowerCase()]: reservation } };
}

export function removeReservation(file: ReservationsFile, name: string): ReservationsFile {
  const rooms = { ...file.rooms };
  delete rooms[name.toLowerCase()];
  return { version: 1, rooms };
}

// Drop expired entries (the CLI prunes on every write so the file can't grow
// stale; the server ignores expired entries either way).
export function pruneExpired(file: ReservationsFile, now: number): ReservationsFile {
  const rooms: Record<string, Reservation> = {};
  for (const [name, r] of Object.entries(file.rooms)) if (!isExpired(r, now)) rooms[name] = r;
  return { version: 1, rooms };
}

export function buildReservation(opts: {
  hostKey: string;
  moderation?: Partial<ModerationPolicy>;
  ttlDays?: number | null;
  note?: string;
  now: number;
}): Reservation {
  const expiresAt =
    opts.ttlDays == null || !Number.isFinite(opts.ttlDays) || opts.ttlDays <= 0
      ? null
      : new Date(opts.now + opts.ttlDays * 24 * 60 * 60 * 1000).toISOString();
  return reservationSchema.parse({
    hostKeyHash: hashHostKey(opts.hostKey),
    moderation: opts.moderation ?? {},
    createdAt: new Date(opts.now).toISOString(),
    expiresAt,
    ...(opts.note ? { note: opts.note } : {}),
  });
}

// The two links the operator hands out: the host's (carries the key — the
// room page stashes it in sessionStorage and strips it from the URL) and the
// public one everybody else gets.
export function buildReservationLinks(
  baseUrl: string,
  name: string,
  hostKey: string,
): { host: string; public: string } {
  const base = baseUrl.replace(/\/+$/, "");
  const room = `${base}/room/${encodeURIComponent(name.toLowerCase())}`;
  return { host: `${room}?host=${encodeURIComponent(hostKey)}`, public: room };
}

// --- File I/O shared by the CLI and the admin UI ---

// Read + validate the file; a missing file is an empty store. A malformed one
// throws (the writers must not silently clobber an operator's typo'd file —
// the read-only server store is the one that degrades to "off" instead).
export function readReservationsFile(filePath: string): ReservationsFile {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_RESERVATIONS;
    throw err;
  }
  const { file, error } = parseReservationsFile(text);
  if (error) throw new Error(`${filePath}: ${error}`);
  return file;
}

// Atomic write (tmp + rename), pruning expired entries. A freshly created file
// is made usable by the service user best-effort: owner/group copied from a
// sibling .env if there is one, else from the parent directory (the data/ dir
// is owned by the service user, so a root-run CLI still leaves a file the
// admin UI can rewrite). chown needs root; failures are ignored and the
// caller's log line says what to check. Returns whether it was created.
export function writeReservationsFile(filePath: string, file: ReservationsFile): boolean {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  let existed = true;
  let mode = 0o640;
  try {
    mode = statSync(filePath).mode & 0o777;
  } catch {
    existed = false;
  }
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(pruneExpired(file, Date.now()), null, 2) + "\n", { mode });
  if (!existed) {
    try {
      let owner: { uid: number; gid: number } | null = null;
      try {
        const env = statSync(path.join(dir, ".env"));
        owner = env;
        chmodSync(tmp, env.mode & 0o777);
      } catch {
        const parent = statSync(dir);
        if (parent.uid !== 0) owner = parent;
      }
      if (owner) chownSync(tmp, owner.uid, owner.gid);
    } catch {
      /* not root, or nothing to copy from — leave 0640 owned by us */
    }
  }
  renameSync(tmp, filePath);
  return !existed;
}

// --- The store the server reads ---

const here = path.dirname(fileURLToPath(import.meta.url));
// <repo>/data/reservations.json: resolved from this file, not cwd (like .env).
export const DEFAULT_RESERVATIONS_FILE = path.resolve(here, "../../data/reservations.json");

export function reservationsFilePath(): string {
  return process.env.RESERVATIONS_FILE || DEFAULT_RESERVATIONS_FILE;
}

export class ReservationStore {
  private file: ReservationsFile = EMPTY_RESERVATIONS;
  private stamp: string | null = null;
  private lastError: string | null = null;

  constructor(
    readonly filePath: string,
    private readonly now: () => number = Date.now,
    private readonly log: (msg: string) => void = (msg) => console.log(msg),
  ) {}

  // Re-read the file if it changed (or appeared/disappeared) since last time.
  // One stat per lookup — cheap, and only on join / room lookup.
  private refresh(): void {
    let stamp: string | null;
    try {
      const st = statSync(this.filePath);
      stamp = `${st.mtimeMs}:${st.size}`;
    } catch {
      stamp = null;
    }
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    if (stamp === null) {
      if (this.file.rooms && Object.keys(this.file.rooms).length > 0) {
        this.log(`[reservations] ${this.filePath} gone — no rooms reserved`);
      }
      this.file = EMPTY_RESERVATIONS;
      this.lastError = null;
      return;
    }
    let text: string;
    try {
      text = readFileSync(this.filePath, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code ?? String(err);
      this.file = EMPTY_RESERVATIONS;
      this.lastError = code;
      this.log(
        `[reservations] could not read ${this.filePath} (${code}) — reservations are OFF. ` +
          "Make it readable by the service user (same owner/mode as .env).",
      );
      return;
    }
    const { file, error } = parseReservationsFile(text);
    this.file = file;
    this.lastError = error;
    if (error) this.log(`[reservations] ${this.filePath}: ${error} — reservations are OFF`);
    else {
      const n = Object.keys(file.rooms).length;
      this.log(`[reservations] loaded ${n} reservation${n === 1 ? "" : "s"} from ${this.filePath}`);
    }
  }

  get(name: string): Reservation | null {
    this.refresh();
    return findReservation(this.file, name, this.now());
  }

  has(name: string): boolean {
    return this.get(name) != null;
  }

  // For the startup log.
  status(): { count: number; error: string | null } {
    this.refresh();
    return { count: Object.keys(this.file.rooms).length, error: this.lastError };
  }
}
