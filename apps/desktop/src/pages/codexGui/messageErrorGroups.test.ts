import { expect, it } from "vitest";
import { groupVisibleTurns } from "./messageErrorGroups";
import { CONTINUE_MESSAGE } from "../../../../../shared/conversation/continuation";
import type { Turn } from "../../../../../shared/conversation/types";

const error = { message: "HTTP 502", additionalDetails: "upstream timed out" };
const failed = (id: string, items: Turn["items"] = []): Turn => ({ id, status: "failed", items, error });
const groups = (turns: Turn[]) => groupVisibleTurns(turns.map((turn, index) => ({
  turn, items: turn.items, followsInterruption: index > 0,
})));

it("keeps only the last identical failure through continuation retries", () => {
  const continued = [{ id: "continue", type: "userMessage", content: [{ type: "text", text: CONTINUE_MESSAGE }] }];
  const result = groups([failed("first"), failed("second", continued), failed("last", continued)]);
  expect(result[0].groups).toEqual([]);
  expect(result[1].groups).toEqual([]);
  expect(result[2].groups).toMatchObject([{ type: "error", count: 3, error: { id: "last:error:0" } }]);
});

it("does not merge different causes or failures separated by real work or a new user message", () => {
  for (const middle of [
    { ...failed("middle"), error: { ...error, additionalDetails: "connection refused" } },
    failed("middle", [{ id: "command", type: "commandExecution", command: "pwd" }]),
    failed("middle", [{ id: "question", type: "userMessage", text: "检查另一个项目" }]),
  ]) {
    const result = groups([failed("first"), middle, failed("last")]);
    expect(result[0].groups).toHaveLength(1);
    expect(result[0].groups[0]).not.toHaveProperty("count");
  }
});

it("only shows the final unresolved failure without changing persisted retry errors", () => {
  const turn = { ...failed("turn"), requestErrors: [true, true, false].map((willRetry, index) => ({
    id: `error-${index}`, afterItemId: null, itemCount: 0, willRetry, error,
  })) };
  expect(groups([turn])[0].groups).toMatchObject([
    { type: "error", error: { id: "error-2", willRetry: false } },
  ]);
  expect(turn.requestErrors).toHaveLength(3);
});
