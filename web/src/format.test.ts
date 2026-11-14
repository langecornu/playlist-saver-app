import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration } from "./format.ts";

test("durations read as m:ss, and h:mm:ss from an hour", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(5), "0:05");
  assert.equal(formatDuration(75), "1:15");
  assert.equal(formatDuration(3599), "59:59");
  assert.equal(formatDuration(3725), "1:02:05");
});

test("odd input never produces nonsense", () => {
  assert.equal(formatDuration(-4), "0:00");
  assert.equal(formatDuration(12.9), "0:12");
});
