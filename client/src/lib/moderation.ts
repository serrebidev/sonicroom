// Moderated rooms ("salas moderadas"): the client half of the permission
// model. Mirrors server/src/moderation-util.ts — the server is the authority
// (every gated event is refused there regardless); this only decides what to
// SHOW. An ordinary private/public room has a null policy and every helper
// answers "allowed", so nothing changes there.

export type Who = "admins" | "everyone" | "nobody";
export type WhoNoNobody = "admins" | "everyone";
export type KickPolicy = "admins" | "admins_vote" | "everyone" | "everyone_vote" | "nobody";

export interface ModerationPolicy {
  multipleAdmins: boolean;
  recording: Who;
  shareAudio: Who;
  streamAudio: Who;
  ducking: WhoNoNobody;
  liveStreaming: Who;
  approveJoins: WhoNoNobody;
  chat: Who;
  // Open (= co-edit; the link is the access) the room's shared notes.
  notes: Who;
  mutePeer: Who;
  muteAll: Who;
  kick: KickPolicy;
  hidePoweredBy: boolean;
}

export type ModerationAction =
  | "recording"
  | "shareAudio"
  | "streamAudio"
  | "ducking"
  | "liveStreaming"
  | "approveJoins"
  | "chat"
  | "notes"
  | "mutePeer"
  | "muteAll";

// The lobby's starting point (and the server's defaults, kept in step).
export const DEFAULT_MODERATION_POLICY: ModerationPolicy = {
  multipleAdmins: false,
  recording: "admins",
  shareAudio: "everyone",
  streamAudio: "everyone",
  ducking: "everyone",
  liveStreaming: "admins",
  approveJoins: "admins",
  chat: "everyone",
  notes: "everyone",
  mutePeer: "admins",
  muteAll: "admins",
  kick: "admins",
  hidePoweredBy: false,
};

const WHO: readonly string[] = ["admins", "everyone", "nobody"];
const WHO_NO_NOBODY: readonly string[] = ["admins", "everyone"];
const KICK: readonly string[] = ["admins", "admins_vote", "everyone", "everyone_vote", "nobody"];

// Coerce anything (a parsed JSON blob from storage, a server payload) into a
// well-formed policy, falling back per field to the default. Never throws.
export function normalizePolicy(raw: unknown): ModerationPolicy {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(key: keyof ModerationPolicy, values: readonly string[]): T =>
    (typeof r[key] === "string" && values.includes(r[key] as string)
      ? (r[key] as string)
      : DEFAULT_MODERATION_POLICY[key]) as T;
  return {
    multipleAdmins:
      typeof r.multipleAdmins === "boolean"
        ? r.multipleAdmins
        : DEFAULT_MODERATION_POLICY.multipleAdmins,
    recording: pick("recording", WHO),
    shareAudio: pick("shareAudio", WHO),
    streamAudio: pick("streamAudio", WHO),
    ducking: pick("ducking", WHO_NO_NOBODY),
    liveStreaming: pick("liveStreaming", WHO),
    approveJoins: pick("approveJoins", WHO_NO_NOBODY),
    chat: pick("chat", WHO),
    notes: pick("notes", WHO),
    mutePeer: pick("mutePeer", WHO),
    muteAll: pick("muteAll", WHO),
    kick: pick("kick", KICK),
    hidePoweredBy:
      typeof r.hidePoweredBy === "boolean"
        ? r.hidePoweredBy
        : DEFAULT_MODERATION_POLICY.hidePoweredBy,
  };
}

// May this peer perform `action`? Unmoderated rooms (null) allow everything
// this module knows about; their own rules live elsewhere.
export function allowed(
  policy: ModerationPolicy | null,
  isAdmin: boolean,
  action: ModerationAction,
): boolean {
  if (!policy) return true;
  const who = policy[action];
  if (who === "everyone") return true;
  if (who === "admins") return isAdmin;
  return false;
}

// How this peer may remove people in a MODERATED room (see the server twin).
// Not defined for a null policy — unmoderated rooms keep vote-to-kick in public
// rooms only, decided by the caller.
export type KickMode = "direct" | "vote" | "none";
export function kickMode(policy: ModerationPolicy, isAdmin: boolean): KickMode {
  switch (policy.kick) {
    case "admins":
      return isAdmin ? "direct" : "none";
    case "admins_vote":
      return isAdmin ? "vote" : "none";
    case "everyone":
      return "direct";
    case "everyone_vote":
      return "vote";
    default:
      return "none";
  }
}

export function voteIsAdminsOnly(policy: ModerationPolicy): boolean {
  return policy.kick === "admins_vote";
}

// --- Lobby → room hand-off ---
// The lobby stores the policy for the room it is about to create under a
// per-room sessionStorage key (the Room reads it on join, and again on a
// reload/rejoin, so a host who refreshes while alone re-creates the same
// moderated room). Keyed by room name so a stale choice can't leak into a
// different room. The last-used policy is ALSO kept in localStorage as a
// convenience default for the next moderated room the host creates.
const SESSION_PREFIX = "sonicroom:moderation:";
const LAST_POLICY_KEY = "sonicroom:moderationPolicy";

export function saveRoomPolicy(roomName: string, policy: ModerationPolicy | null) {
  try {
    if (policy) {
      sessionStorage.setItem(SESSION_PREFIX + roomName, JSON.stringify(policy));
      localStorage.setItem(LAST_POLICY_KEY, JSON.stringify(policy));
    } else {
      sessionStorage.removeItem(SESSION_PREFIX + roomName);
    }
  } catch {
    // Storage unavailable (private mode / quota): the room is simply created
    // unmoderated, or moderated once without a persisted default.
  }
}

export function loadRoomPolicy(roomName: string): ModerationPolicy | null {
  try {
    const raw = sessionStorage.getItem(SESSION_PREFIX + roomName);
    return raw ? normalizePolicy(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function loadLastPolicy(): ModerationPolicy {
  try {
    const raw = localStorage.getItem(LAST_POLICY_KEY);
    return raw ? normalizePolicy(JSON.parse(raw)) : { ...DEFAULT_MODERATION_POLICY };
  } catch {
    return { ...DEFAULT_MODERATION_POLICY };
  }
}
