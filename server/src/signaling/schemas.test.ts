import { test } from "node:test";
import assert from "node:assert/strict";
import { roomNameSchema } from "./schemas.js";

test("roomNameSchema lowercases so room names are case-insensitive", () => {
  assert.equal(roomNameSchema.parse("MyRoom"), "myroom");
  assert.equal(roomNameSchema.parse("Team_Call-2"), "team_call-2");
  assert.equal(roomNameSchema.parse("already"), "already");
});

test("roomNameSchema still rejects invalid names", () => {
  assert.equal(roomNameSchema.safeParse("").success, false);
  assert.equal(roomNameSchema.safeParse("has space").success, false);
  assert.equal(roomNameSchema.safeParse("a".repeat(65)).success, false);
});
