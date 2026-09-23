import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  allowed,
  kickMode,
  moderationPolicySchema,
  voteIsAdminsOnly,
  type ModerationPolicy,
} from "./moderation-util.js";

const base = (): ModerationPolicy => moderationPolicySchema.parse({});

describe("moderationPolicySchema", () => {
  it("fills every field with a default so a client may send only what changed", () => {
    const p = base();
    assert.equal(p.multipleAdmins, false);
    assert.equal(p.recording, "admins");
    assert.equal(p.shareAudio, "everyone");
    assert.equal(p.streamAudio, "everyone");
    assert.equal(p.ducking, "everyone");
    assert.equal(p.liveStreaming, "admins");
    assert.equal(p.approveJoins, "admins");
    assert.equal(p.chat, "everyone");
    assert.equal(p.notes, "everyone");
    assert.equal(p.mutePeer, "admins");
    assert.equal(p.muteAll, "admins");
    assert.equal(p.kick, "admins");
    assert.equal(p.hidePoweredBy, false);
  });

  it("rejects 'nobody' where an action can't be switched off", () => {
    assert.equal(moderationPolicySchema.safeParse({ ducking: "nobody" }).success, false);
    assert.equal(moderationPolicySchema.safeParse({ approveJoins: "nobody" }).success, false);
  });

  it("rejects unknown values", () => {
    assert.equal(moderationPolicySchema.safeParse({ kick: "owner" }).success, false);
    assert.equal(moderationPolicySchema.safeParse({ chat: true }).success, false);
  });
});

describe("allowed", () => {
  it("allows everything in an unmoderated room (null policy)", () => {
    assert.equal(allowed(null, false, "recording"), true);
    assert.equal(allowed(undefined, false, "chat"), true);
  });

  it("'admins' admits admins only", () => {
    const p = base();
    assert.equal(allowed(p, true, "recording"), true);
    assert.equal(allowed(p, false, "recording"), false);
  });

  it("'everyone' admits anyone, 'nobody' admits no one — not even an admin", () => {
    const p = { ...base(), chat: "everyone" as const, shareAudio: "nobody" as const };
    assert.equal(allowed(p, false, "chat"), true);
    assert.equal(allowed(p, true, "shareAudio"), false);
    assert.equal(allowed(p, false, "shareAudio"), false);
  });
});

describe("kickMode", () => {
  it("admins: admins kick directly, others not at all", () => {
    const p = { ...base(), kick: "admins" as const };
    assert.equal(kickMode(p, true), "direct");
    assert.equal(kickMode(p, false), "none");
  });

  it("admins_vote: admins vote among themselves, others not at all", () => {
    const p = { ...base(), kick: "admins_vote" as const };
    assert.equal(kickMode(p, true), "vote");
    assert.equal(kickMode(p, false), "none");
    assert.equal(voteIsAdminsOnly(p), true);
  });

  it("everyone / everyone_vote apply to admins and non-admins alike", () => {
    assert.equal(kickMode({ ...base(), kick: "everyone" }, false), "direct");
    assert.equal(kickMode({ ...base(), kick: "everyone" }, true), "direct");
    assert.equal(kickMode({ ...base(), kick: "everyone_vote" }, false), "vote");
    assert.equal(voteIsAdminsOnly({ ...base(), kick: "everyone_vote" }), false);
  });

  it("nobody disables kicking for everyone", () => {
    const p = { ...base(), kick: "nobody" as const };
    assert.equal(kickMode(p, true), "none");
    assert.equal(kickMode(p, false), "none");
  });
});
