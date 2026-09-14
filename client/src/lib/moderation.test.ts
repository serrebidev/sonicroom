import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_MODERATION_POLICY,
  allowed,
  kickMode,
  loadLastPolicy,
  loadRoomPolicy,
  normalizePolicy,
  saveRoomPolicy,
} from "./moderation";

describe("normalizePolicy", () => {
  it("returns the defaults for junk", () => {
    expect(normalizePolicy(undefined)).toEqual(DEFAULT_MODERATION_POLICY);
    expect(normalizePolicy("nope")).toEqual(DEFAULT_MODERATION_POLICY);
    expect(normalizePolicy({ recording: "owner", kick: 3 })).toEqual(DEFAULT_MODERATION_POLICY);
  });

  it("keeps valid fields and refuses 'nobody' where it isn't an option", () => {
    const p = normalizePolicy({ chat: "nobody", ducking: "nobody", kick: "everyone_vote" });
    expect(p.chat).toBe("nobody");
    expect(p.ducking).toBe("everyone");
    expect(p.kick).toBe("everyone_vote");
  });
});

describe("allowed / kickMode", () => {
  it("allows everything in an unmoderated room", () => {
    expect(allowed(null, false, "recording")).toBe(true);
  });

  it("gates on the policy and the admin flag", () => {
    const p = { ...DEFAULT_MODERATION_POLICY, shareAudio: "nobody" as const };
    expect(allowed(p, false, "recording")).toBe(false);
    expect(allowed(p, true, "recording")).toBe(true);
    expect(allowed(p, true, "shareAudio")).toBe(false);
    expect(allowed(p, false, "chat")).toBe(true);
  });

  it("maps the kick policy to a mode per peer", () => {
    expect(kickMode({ ...DEFAULT_MODERATION_POLICY, kick: "admins" }, true)).toBe("direct");
    expect(kickMode({ ...DEFAULT_MODERATION_POLICY, kick: "admins" }, false)).toBe("none");
    expect(kickMode({ ...DEFAULT_MODERATION_POLICY, kick: "admins_vote" }, true)).toBe("vote");
    expect(kickMode({ ...DEFAULT_MODERATION_POLICY, kick: "everyone_vote" }, false)).toBe("vote");
    expect(kickMode({ ...DEFAULT_MODERATION_POLICY, kick: "nobody" }, true)).toBe("none");
  });
});

describe("lobby → room hand-off", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("stores the policy per room and as the last-used default", () => {
    const p = { ...DEFAULT_MODERATION_POLICY, chat: "admins" as const };
    saveRoomPolicy("tertulia", p);
    expect(loadRoomPolicy("tertulia")).toEqual(p);
    expect(loadRoomPolicy("other")).toBeNull();
    expect(loadLastPolicy()).toEqual(p);
  });

  it("clears the per-room policy when the host unticks admin options", () => {
    saveRoomPolicy("tertulia", DEFAULT_MODERATION_POLICY);
    saveRoomPolicy("tertulia", null);
    expect(loadRoomPolicy("tertulia")).toBeNull();
  });
});
