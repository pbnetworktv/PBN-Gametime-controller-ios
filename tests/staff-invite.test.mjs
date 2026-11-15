import assert from "node:assert/strict";
import test from "node:test";
import { staffInviteFromLink, staffInviteLink } from "../src/staff-invite.js";

test("shared links preserve the event code and the selected calendar date", () => {
  const expected = { code: "D34A78", day: "2030-06-08" };
  assert.deepEqual(staffInviteFromLink(staffInviteLink("d34a78", expected.day)), expected);
  assert.deepEqual(staffInviteFromLink("pbngametimecontroller://staff/join?code=d34a78&day=2030-06-08"), expected);
  assert.deepEqual(staffInviteFromLink(staffInviteLink("D34A78")), { code: "D34A78", day: null });
});

test("links with unrelated hosts or paths cannot open the staff join screen", () => {
  assert.equal(staffInviteFromLink("https://example.test/game-time/staff/join?code=D34A78"), null);
  assert.equal(staffInviteFromLink("pbngametimecontroller://staff/settings?code=D34A78"), null);
  assert.equal(staffInviteFromLink("pbngametimecontroller://staff/join?code=short"), null);
});
