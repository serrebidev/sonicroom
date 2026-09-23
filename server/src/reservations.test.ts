import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildReservation,
  buildReservationLinks,
  findReservation,
  generateHostKey,
  hashHostKey,
  isExpired,
  parseReservationsFile,
  pruneExpired,
  removeReservation,
  ReservationStore,
  upsertReservation,
  verifyHostKey,
} from "./reservations.js";

const NOW = Date.parse("2026-09-15T12:00:00Z");

describe("host keys", () => {
  it("generates URL-safe keys and verifies only the matching one", () => {
    const key = generateHostKey();
    assert.match(key, /^[A-Za-z0-9_-]{32}$/);
    const r = buildReservation({ hostKey: key, now: NOW });
    assert.equal(r.hostKeyHash, hashHostKey(key));
    assert.equal(verifyHostKey(r, key), true);
    assert.equal(verifyHostKey(r, key + "x"), false);
    assert.equal(verifyHostKey(r, ""), false);
    assert.equal(verifyHostKey(r, null), false);
    assert.equal(verifyHostKey(r, undefined), false);
  });

  it("never stores the key itself", () => {
    const r = buildReservation({ hostKey: "secret-key", now: NOW });
    assert.equal(JSON.stringify(r).includes("secret-key"), false);
  });
});

describe("buildReservation", () => {
  it("fills the policy defaults and stamps createdAt", () => {
    const r = buildReservation({ hostKey: "k", now: NOW, moderation: { chat: "admins" } });
    assert.equal(r.moderation.chat, "admins");
    assert.equal(r.moderation.recording, "admins");
    assert.equal(r.moderation.multipleAdmins, false);
    assert.equal(r.createdAt, "2026-09-15T12:00:00.000Z");
    assert.equal(r.expiresAt, null);
  });

  it("turns a TTL in days into an expiry, and no/zero TTL into never", () => {
    const r = buildReservation({ hostKey: "k", now: NOW, ttlDays: 30 });
    assert.equal(r.expiresAt, "2026-10-15T12:00:00.000Z");
    assert.equal(buildReservation({ hostKey: "k", now: NOW, ttlDays: 0 }).expiresAt, null);
    assert.equal(buildReservation({ hostKey: "k", now: NOW, ttlDays: null }).expiresAt, null);
  });

  it("keeps an operator note", () => {
    assert.equal(
      buildReservation({ hostKey: "k", now: NOW, note: "Ana's show" }).note,
      "Ana's show",
    );
  });
});

describe("expiry", () => {
  it("expires at the timestamp, not before", () => {
    const r = buildReservation({ hostKey: "k", now: NOW, ttlDays: 1 });
    assert.equal(isExpired(r, NOW), false);
    assert.equal(isExpired(r, NOW + 24 * 3600 * 1000 - 1), false);
    assert.equal(isExpired(r, NOW + 24 * 3600 * 1000), true);
  });

  it("findReservation ignores expired entries and matches case-insensitively", () => {
    const live = buildReservation({ hostKey: "a", now: NOW, ttlDays: 7 });
    const dead = buildReservation({ hostKey: "b", now: NOW - 10 * 86400e3, ttlDays: 1 });
    let file = upsertReservation({ version: 1, rooms: {} }, "Studio", live);
    file = upsertReservation(file, "old", dead);
    assert.equal(findReservation(file, "studio", NOW), live);
    assert.equal(findReservation(file, "STUDIO", NOW), live);
    assert.equal(findReservation(file, "old", NOW), null);
    assert.equal(findReservation(file, "nope", NOW), null);
  });

  it("pruneExpired drops only the expired ones", () => {
    const live = buildReservation({ hostKey: "a", now: NOW, ttlDays: 7 });
    const dead = buildReservation({ hostKey: "b", now: NOW - 10 * 86400e3, ttlDays: 1 });
    const forever = buildReservation({ hostKey: "c", now: NOW });
    const file = { version: 1 as const, rooms: { live, dead, forever } };
    assert.deepEqual(Object.keys(pruneExpired(file, NOW).rooms).sort(), ["forever", "live"]);
  });
});

describe("upsert / remove", () => {
  it("keys by lowercase name, replaces in place and removes", () => {
    const a = buildReservation({ hostKey: "a", now: NOW });
    const b = buildReservation({ hostKey: "b", now: NOW });
    let file = upsertReservation({ version: 1, rooms: {} }, "Room", a);
    file = upsertReservation(file, "room", b);
    assert.deepEqual(Object.keys(file.rooms), ["room"]);
    assert.equal(file.rooms.room, b);
    file = removeReservation(file, "ROOM");
    assert.deepEqual(file.rooms, {});
  });
});

describe("parseReservationsFile", () => {
  it("accepts a valid file, lowercases names and fills policy defaults", () => {
    const text = JSON.stringify({
      version: 1,
      rooms: { Studio: { hostKeyHash: hashHostKey("k"), moderation: { kick: "admins_vote" } } },
    });
    const { file, error } = parseReservationsFile(text);
    assert.equal(error, null);
    assert.ok(file.rooms.studio);
    assert.equal(file.rooms.studio.moderation.kick, "admins_vote");
    assert.equal(file.rooms.studio.moderation.chat, "everyone");
  });

  it("yields an empty store (never throws) on bad JSON or a bad shape", () => {
    const bad = parseReservationsFile("{ nope");
    assert.deepEqual(bad.file.rooms, {});
    assert.match(bad.error!, /invalid JSON/);
    const shape = parseReservationsFile(JSON.stringify({ version: 2, rooms: {} }));
    assert.deepEqual(shape.file.rooms, {});
    assert.match(shape.error!, /invalid reservations file/);
    const hash = parseReservationsFile(
      JSON.stringify({ version: 1, rooms: { x: { hostKeyHash: "short" } } }),
    );
    assert.deepEqual(hash.file.rooms, {});
    assert.match(hash.error!, /rooms\.x\.hostKeyHash/);
  });
});

describe("buildReservationLinks", () => {
  it("builds the host and public links", () => {
    const links = buildReservationLinks("https://meet.example/", "My Show", "abc_-");
    assert.equal(links.public, "https://meet.example/room/my%20show");
    assert.equal(links.host, "https://meet.example/room/my%20show?host=abc_-");
  });
});

describe("ReservationStore", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sonicroom-res-"));
  const file = path.join(dir, "reservations.json");
  const logs: string[] = [];
  const store = new ReservationStore(
    file,
    () => NOW,
    (m) => logs.push(m),
  );
  const write = (rooms: Record<string, unknown>, mtimeSec: number) => {
    writeFileSync(file, JSON.stringify({ version: 1, rooms }));
    // Force distinct mtimes so back-to-back writes are seen as changes.
    utimesSync(file, mtimeSec, mtimeSec);
  };

  it("is empty when the file is missing", () => {
    assert.equal(store.get("studio"), null);
    assert.deepEqual(store.status(), { count: 0, error: null });
  });

  it("picks up the file when it appears, and changes without a restart", () => {
    write({ studio: { hostKeyHash: hashHostKey("k1") } }, 1_000_000);
    const r = store.get("studio");
    assert.ok(r);
    assert.equal(verifyHostKey(r, "k1"), true);
    assert.equal(store.has("Studio"), true);

    write(
      { studio: { hostKeyHash: hashHostKey("k2") }, other: { hostKeyHash: hashHostKey("o") } },
      1_000_001,
    );
    assert.equal(verifyHostKey(store.get("studio")!, "k1"), false);
    assert.equal(verifyHostKey(store.get("studio")!, "k2"), true);
    assert.equal(store.has("other"), true);
    assert.equal(store.status().count, 2);
  });

  it("ignores expired entries", () => {
    write(
      { studio: { hostKeyHash: hashHostKey("k"), expiresAt: "2026-09-15T11:59:59Z" } },
      1_000_002,
    );
    assert.equal(store.get("studio"), null);
    assert.equal(store.status().count, 1);
  });

  it("turns reservations off (and says so) on a malformed file, then recovers", () => {
    writeFileSync(file, "{ broken");
    utimesSync(file, 1_000_003, 1_000_003);
    assert.equal(store.get("studio"), null);
    assert.match(store.status().error!, /invalid JSON/);
    assert.ok(logs.some((l) => l.includes("reservations are OFF")));
    write({ studio: { hostKeyHash: hashHostKey("k") } }, 1_000_004);
    assert.ok(store.get("studio"));
    assert.equal(store.status().error, null);
  });

  it("empties again when the file is removed", () => {
    rmSync(file);
    assert.equal(store.get("studio"), null);
    rmSync(dir, { recursive: true, force: true });
  });
});
