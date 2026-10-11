import { ProviderRuntimeEvent, ThreadId } from "@synara/contracts";
import { Schema } from "effect";
import { expect, it } from "vitest";
import {
  assertSessionTeardownConformance,
  assertTerminalOutcomeConformance,
} from "./adapterLifecycleConformance";

const base = {
  eventId: "event",
  provider: "codex",
  threadId: "thread",
  createdAt: "2026-10-11T10:00:00.000Z",
  lifecycleGeneration: "generation",
};
const completed = Schema.decodeUnknownSync(ProviderRuntimeEvent)({
  ...base,
  type: "turn.completed",
  turnId: "turn",
  payload: { state: "completed" },
});
const exited = Schema.decodeUnknownSync(ProviderRuntimeEvent)({
  ...base,
  type: "session.exited",
  payload: {},
});

it("rejects duplicate terminal outcomes for one generation and turn", () => {
  expect(() => assertTerminalOutcomeConformance([completed, completed])).toThrow(
    "duplicate terminal outcome",
  );
  expect(() =>
    assertTerminalOutcomeConformance([
      completed,
      { ...completed, lifecycleGeneration: "next-generation" },
    ]),
  ).not.toThrow();
});
it("rejects a terminal outcome without a turn identity", () => {
  const { turnId: _turnId, ...missingTurn } = completed;
  expect(() => assertTerminalOutcomeConformance([missingTurn])).toThrow("identify their turn");
});
it("rejects runtime output after teardown and an unfenced observation", () => {
  expect(() =>
    assertSessionTeardownConformance([exited, completed], ThreadId.makeUnsafe("thread")),
  ).toThrow("further runtime events");
  expect(() =>
    assertSessionTeardownConformance([completed], ThreadId.makeUnsafe("thread")),
  ).toThrow("exit fence");
});
