// Operator CLI for room RESERVATIONS (see src/reservations.ts): hand a room
// name to a host so nobody can open it before them, and fix its moderation
// policy in advance.
//
//   pnpm reserve <room> [--days N] [--policy <file.json|{json}>] [--note "…"] [--base-url URL]
//   pnpm reserve --rotate <room>       new host key, same policy (old link stops working)
//   pnpm reserve --remove <room>
//   pnpm reserve --list
//
// Prints the HOST link (carries the key — give it to the host only) and the
// PUBLIC link (advertise this one). The key is printed exactly once and never
// stored: only its SHA-256 goes into the file, so a lost key means --rotate.
//
// Writes RESERVATIONS_FILE (default <repo>/data/reservations.json, gitignored
// and never served). The server re-reads the file on change — no restart
// needed. Same actions as the admin UI at /admin; this is the no-browser route.
import "../src/load-env.js";
import { readFileSync } from "node:fs";
import { roomNameSchema } from "../src/signaling/schemas.js";
import { moderationPolicySchema } from "../src/moderation-util.js";
import {
  buildReservation,
  buildReservationLinks,
  generateHostKey,
  pruneExpired,
  readReservationsFile,
  removeReservation,
  reservationsFilePath,
  upsertReservation,
  writeReservationsFile,
  type ReservationsFile,
} from "../src/reservations.js";

const DEFAULT_DAYS = 30;

function usage(code: number): never {
  const lines = [
    "Usage:",
    "  pnpm reserve <room> [--days N] [--policy <file.json|{json}>] [--note TEXT] [--base-url URL]",
    "  pnpm reserve --rotate <room> [--base-url URL]",
    "  pnpm reserve --remove <room>",
    "  pnpm reserve --list",
    "",
    `  --days N       expiry in days (default ${DEFAULT_DAYS}; 0 = never)`,
    "  --policy       moderation policy: a JSON file path or inline JSON; omitted fields use the defaults",
    "  --base-url     instance origin for the printed links (default: $PUBLIC_URL or http://localhost:3100)",
  ];
  console.error(lines.join("\n"));
  process.exit(code);
}

function parseArgs(argv: string[]) {
  const opts: {
    room?: string;
    days: number;
    policy?: string;
    note?: string;
    baseUrl: string;
    mode: "reserve" | "rotate" | "remove" | "list";
  } = {
    days: DEFAULT_DAYS,
    baseUrl: process.env.PUBLIC_URL || "http://localhost:3100",
    mode: "reserve",
  };
  const takeValue = (i: number, flag: string) => {
    const v = argv[i + 1];
    if (v == null) {
      console.error(`${flag} needs a value`);
      usage(2);
    }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
        usage(0);
      // eslint-disable-next-line no-fallthrough
      case "--list":
        opts.mode = "list";
        break;
      case "--remove":
        opts.mode = "remove";
        opts.room = takeValue(i++, a);
        break;
      case "--rotate":
        opts.mode = "rotate";
        opts.room = takeValue(i++, a);
        break;
      case "--days":
        opts.days = Number(takeValue(i++, a));
        if (!Number.isFinite(opts.days) || opts.days < 0) {
          console.error("--days must be a non-negative number");
          usage(2);
        }
        break;
      case "--policy":
        opts.policy = takeValue(i++, a);
        break;
      case "--note":
        opts.note = takeValue(i++, a);
        break;
      case "--base-url":
        opts.baseUrl = takeValue(i++, a);
        break;
      default:
        if (a.startsWith("-") || opts.room) {
          console.error(`unexpected argument: ${a}`);
          usage(2);
        }
        opts.room = a;
    }
  }
  if (opts.mode !== "list" && !opts.room) usage(2);
  return opts;
}

function readStore(file: string): ReservationsFile {
  try {
    return readReservationsFile(file);
  } catch (err) {
    console.error(`${(err as Error).message}\nFix or delete the file and retry.`);
    process.exit(1);
  }
}

function writeStore(file: string, store: ReservationsFile): void {
  if (writeReservationsFile(file, store)) {
    console.error(
      `created ${file} — make sure the service user can read AND write it (the admin UI writes it too): ` +
        "e.g. chown sonicroom:sonicroom && chmod 640.",
    );
  }
}

function loadPolicy(spec: string | undefined) {
  if (!spec) return {};
  const text = spec.trim().startsWith("{") ? spec : readFileSync(spec, "utf8");
  const parsed = moderationPolicySchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    console.error(`invalid policy: ${issue?.path.join(".")}: ${issue?.message}`);
    process.exit(2);
  }
  return parsed.data;
}

function printLinks(baseUrl: string, room: string, key: string) {
  const links = buildReservationLinks(baseUrl, room, key);
  console.log("");
  console.log(`HOST link   (give ONLY to the host):  ${links.host}`);
  console.log(`PUBLIC link (advertise this one):     ${links.public}`);
  console.log("");
  console.log("The host key is not stored anywhere — if it's lost, run --rotate.");
}

const opts = parseArgs(process.argv.slice(2));
const file = reservationsFilePath();
const now = Date.now();
let store = pruneExpired(readStore(file), now);

if (opts.mode === "list") {
  const names = Object.keys(store.rooms).sort();
  if (names.length === 0) {
    console.log(`no reservations (${file})`);
  } else {
    for (const name of names) {
      const r = store.rooms[name];
      const exp = r.expiresAt ? `expires ${r.expiresAt}` : "never expires";
      console.log(`${name.padEnd(24)} ${exp}${r.note ? `  — ${r.note}` : ""}`);
    }
  }
  process.exit(0);
}

const room = roomNameSchema.safeParse(opts.room);
if (!room.success) {
  console.error(`invalid room name "${opts.room}": ${room.error.issues[0]?.message}`);
  process.exit(2);
}
const name = room.data;

if (opts.mode === "remove") {
  if (!store.rooms[name]) {
    console.error(`${name} is not reserved`);
    process.exit(1);
  }
  writeStore(file, removeReservation(store, name));
  console.log(`removed reservation for ${name}`);
  process.exit(0);
}

if (opts.mode === "rotate") {
  const existing = store.rooms[name];
  if (!existing) {
    console.error(`${name} is not reserved — use \`pnpm reserve ${name}\` to reserve it`);
    process.exit(1);
  }
  const key = generateHostKey();
  const ttlDays = existing.expiresAt
    ? Math.max(0, (Date.parse(existing.expiresAt) - now) / 86400e3)
    : null;
  const rotated = buildReservation({
    hostKey: key,
    moderation: existing.moderation,
    ttlDays,
    note: existing.note,
    now,
  });
  writeStore(file, upsertReservation(store, name, { ...rotated, createdAt: existing.createdAt }));
  console.log(`rotated the host key for ${name} (the old host link no longer works)`);
  printLinks(opts.baseUrl, name, key);
  process.exit(0);
}

// reserve
const key = generateHostKey();
const reservation = buildReservation({
  hostKey: key,
  moderation: loadPolicy(opts.policy),
  ttlDays: opts.days,
  note: opts.note,
  now,
});
const replacing = !!store.rooms[name];
store = upsertReservation(store, name, reservation);
writeStore(file, store);
console.log(
  `${replacing ? "re-reserved" : "reserved"} ${name}` +
    (reservation.expiresAt ? ` until ${reservation.expiresAt}` : " (never expires)") +
    ` — the room will open as a moderated room, its host is whoever holds the key below.`,
);
printLinks(opts.baseUrl, name, key);
