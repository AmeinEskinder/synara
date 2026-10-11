import assert from "node:assert/strict";
import {
  ThreadId,
  type ProviderRuntimeEvent,
  type ProviderSessionStartInput,
} from "@synara/contracts";
import { Effect } from "effect";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";

/** Exercise the public ownership contract, independent of the native transport. */
export function assertAdapterCleanupConformance<E>(
  adapter: ProviderAdapterShape<E>,
  input: Omit<ProviderSessionStartInput, "threadId">,
): Effect.Effect<void, E> {
  return Effect.gen(function* () {
    const first = ThreadId.makeUnsafe("conformance-first");
    const second = ThreadId.makeUnsafe("conformance-second");
    yield* adapter.stopSession(first);
    yield* adapter.startSession({ ...input, threadId: first });
    yield* adapter.startSession({ ...input, threadId: second });
    assert.equal(yield* adapter.hasSession(first), true, "start must acquire ownership");
    assert.equal(yield* adapter.hasSession(second), true);
    yield* adapter.stopSession(first);
    yield* adapter.stopSession(first);
    assert.equal(yield* adapter.hasSession(first), false, "stop must release ownership");
    assert.equal(yield* adapter.hasSession(second), true, "stop must preserve other sessions");
    yield* adapter.stopAll();
    yield* adapter.stopAll();
    assert.equal(yield* adapter.hasSession(second), false, "stopAll must release every session");
    assert.deepEqual(yield* adapter.listSessions(), []);
  });
}

/** Check a collected, fenced event sequence; observation length belongs to the transport harness. */
export function assertTerminalOutcomeConformance(
  events: ReadonlyArray<ProviderRuntimeEvent>,
): void {
  const outcomes = new Set<string>();
  for (const event of events) {
    if (event.type !== "turn.completed" && event.type !== "turn.aborted") continue;
    assert.ok(event.turnId, "terminal outcomes must identify their turn");
    const key = JSON.stringify([event.threadId, event.lifecycleGeneration, event.turnId]);
    assert.equal(outcomes.has(key), false, `duplicate terminal outcome for ${event.turnId}`);
    outcomes.add(key);
  }
  assert.ok(outcomes.size > 0, "the observed lifecycle must settle a turn");
}

export function assertSessionTeardownConformance(
  events: ReadonlyArray<ProviderRuntimeEvent>,
  threadId: ThreadId,
): void {
  let exited = false;
  for (const event of events) {
    if (event.threadId !== threadId) continue;
    assert.equal(exited, false, "a stopped session must not emit further runtime events");
    if (event.type === "session.exited") exited = true;
  }
  assert.equal(exited, true, "the observation must include the session exit fence");
}
