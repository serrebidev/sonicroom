import { z } from "zod";

// Moderated rooms ("salas moderadas"): an OPT-IN third room type, next to the
// private and public rooms, for hosted talk shows where a host must be able to
// silence someone who forgot to mute, or eject a troll at once.
//
// The existing private/public rooms have no moderators BY DESIGN (collective
// knock-to-join + vote-to-kick only) and nothing here changes them: every
// helper below answers "allowed" for a `null` policy, so an unmoderated room
// behaves byte-for-byte as before. Only a room created with a policy ever has
// admins.
//
// This module is PURE (policy schema + permission checks) so it's unit-tested
// like kick-util; the stateful bits (who is an admin, forced mutes) live in
// room-manager / the signaling handlers.

// Who may perform an action: only admins, everyone, or nobody at all.
export const whoSchema = z.enum(["admins", "everyone", "nobody"]);
export type Who = z.infer<typeof whoSchema>;
// Actions that can't sensibly be switched off entirely.
export const whoNoNobodySchema = z.enum(["admins", "everyone"]);
export type WhoNoNobody = z.infer<typeof whoNoNobodySchema>;
// Kick: direct (no vote) or by the usual collective vote among the eligible set.
export const kickPolicySchema = z.enum([
  "admins",
  "admins_vote",
  "everyone",
  "everyone_vote",
  "nobody",
]);
export type KickPolicy = z.infer<typeof kickPolicySchema>;

// The policy a moderated room is created with (from the lobby's "Admin
// options"). Fixed for the room's lifetime, like isPublic/isVideo. Every field
// has a default so a client may send only what it changed.
export const moderationPolicySchema = z.object({
  // Whether admins may name co-admins ("Allow several admins").
  multipleAdmins: z.boolean().default(false),
  recording: whoSchema.default("admins"),
  // Share system/tab audio (`start-share`).
  shareAudio: whoSchema.default("everyone"),
  // Stream a file / URL / library file or extra microphones into the call
  // (`start-file-stream`, `start-extra-mic`).
  streamAudio: whoSchema.default("everyone"),
  ducking: whoNoNobodySchema.default("everyone"),
  liveStreaming: whoSchema.default("admins"),
  approveJoins: whoNoNobodySchema.default("admins"),
  chat: whoSchema.default("everyone"),
  // Mute ONE participant for everyone (soft: they can unmute themselves).
  mutePeer: whoSchema.default("admins"),
  // Mute EVERYONE else at once.
  muteAll: whoSchema.default("admins"),
  kick: kickPolicySchema.default("admins"),
  // Hide the "Powered by SonicRoom" footer link inside this room.
  hidePoweredBy: z.boolean().default(false),
});
export type ModerationPolicy = z.infer<typeof moderationPolicySchema>;

// The actions gated by a plain who-may-do-it setting (kick has its own modes).
export type ModerationAction =
  | "recording"
  | "shareAudio"
  | "streamAudio"
  | "ducking"
  | "liveStreaming"
  | "approveJoins"
  | "chat"
  | "mutePeer"
  | "muteAll";

// May this peer perform `action`? An unmoderated room (null policy) allows
// everything this module knows about — the existing rules (public-only vote
// kick, etc.) are enforced by their own handlers, not here.
export function allowed(
  policy: ModerationPolicy | null | undefined,
  isAdmin: boolean,
  action: ModerationAction,
): boolean {
  if (!policy) return true;
  const who = policy[action];
  if (who === "everyone") return true;
  if (who === "admins") return isAdmin;
  return false;
}

// How this peer may remove people in a moderated room:
//   "direct" — immediately, no vote (the admin path);
//   "vote"   — by the usual collective vote, among the eligible set
//              (admins only for "admins_vote", everyone for "everyone_vote");
//   "none"   — not at all.
// A null policy is NOT handled here: unmoderated rooms keep their own rule
// (vote-to-kick in public rooms only), so callers must branch on the policy
// first.
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

// Whether a vote-kick electorate in a moderated room is admins-only (so both
// who may vote and how many voters the threshold counts come from the admin
// set rather than from every human in the room).
export function voteIsAdminsOnly(policy: ModerationPolicy): boolean {
  return policy.kick === "admins_vote";
}
