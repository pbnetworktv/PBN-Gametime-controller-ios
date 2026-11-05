import assert from "node:assert/strict";
import test from "node:test";
import { raceToComplete } from "../src/controller-rules.js";
test("race-to finishes only after a decisive target score", () => {
  assert.equal(raceToComplete({ leftScore: 2, rightScore: 1 }, "Race-to", "3", "single"), false);
  assert.equal(raceToComplete({ leftScore: 3, rightScore: 1 }, "Race-to", "3", "single"), true);
  assert.equal(raceToComplete({ leftScore: 2, rightScore: 3 }, "race-to", 3, "single"), true);
  assert.equal(raceToComplete({ leftScore: 3, rightScore: 3 }, "race-to", 3, "single"), false);
  assert.equal(raceToComplete({ leftScore: 9, rightScore: 1 }, "uncapped", 3, "single"), false);
  assert.equal(raceToComplete({ leftScore: 3, rightScore: 1 }, "race-to", 3, "split"), false);
});
