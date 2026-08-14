import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { ORCHESTRATION_WS_CHANNELS, ORCHESTRATION_WS_METHODS } from "./orchestration";
import { WebSocketRequest, WsResponse, WS_CHANNELS } from "./ws";

const decode = <S extends Schema.Top>(
  schema: S,
  input: unknown,
): Effect.Effect<Schema.Schema.Type<S>, Schema.SchemaError, never> =>
  Schema.decodeUnknownEffect(schema as never)(input) as Effect.Effect<
    Schema.Schema.Type<S>,
    Schema.SchemaError,
    never
  >;

it.effect("rejects getTurnDiff requests when fromTurnCount > toTurnCount", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decode(WebSocketRequest, {
        id: "req-1",
        body: {
          _tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
          threadId: "thread-1",
          fromTurnCount: 3,
          toTurnCount: 2,
        },
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("trims websocket request id and nested orchestration ids", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(WebSocketRequest, {
      id: " req-1 ",
      body: {
        _tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
        threadId: " thread-1 ",
        fromTurnCount: 0,
        toTurnCount: 0,
      },
    });
    assert.strictEqual(parsed.id, "req-1");
    assert.strictEqual(parsed.body._tag, ORCHESTRATION_WS_METHODS.getTurnDiff);
    if (parsed.body._tag === ORCHESTRATION_WS_METHODS.getTurnDiff) {
      assert.strictEqual(parsed.body.threadId, "thread-1");
    }
  }),
);

it.effect("accepts every hosts namespace request", () =>
  Effect.gen(function* () {
    const requests = [
      [WS_METHODS.hostsList, {}],
      [WS_METHODS.hostsUpdate, { hostId: "host_1", discoverable: false, name: "Ada's Mac" }],
      [WS_METHODS.hostsDelete, { hostId: "host_1" }],
      [WS_METHODS.hostsListDevices, {}],
      [WS_METHODS.hostsRevokeDevice, { deviceId: "00000000-0000-4000-8000-000000000001" }],
      [WS_METHODS.hostsApproveDeviceLink, { userCode: "ABCDEFGH" }],
      [WS_METHODS.hostsRequestGrant, { hostId: "host_1" }],
      [WS_METHODS.hostsEnrollment, {}],
      [WS_METHODS.hostsUnlinkLocalHost, {}],
      [WS_METHODS.hostsListSessions, {}],
      [WS_METHODS.hostsEndSession, { sessionId: "session_1" }],
      [WS_METHODS.hostsBeginSyncKeyPairing, {}],
      [
        WS_METHODS.hostsOfferSyncKey,
        {
          recipientDeviceId: "00000000-0000-4000-8000-000000000001",
          recipientPublicJwk: { kty: "EC", crv: "P-256", x: "eA", y: "eQ" },
        },
      ],
      [WS_METHODS.hostsReceiveSyncKey, {}],
      [WS_METHODS.hostsConfirmSyncKey, { verificationCode: "ABC234" }],
    ] as const;

    for (const [method, input] of requests) {
      const parsed = yield* decode(WebSocketRequest, {
        id: `req-${method}`,
        body: { _tag: method, ...input },
      });
      assert.strictEqual(parsed.body._tag, method);
    }
  }),
);

it.effect("accepts typed websocket push envelopes with sequence", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(WsResponse, {
      type: "push",
      sequence: 1,
      channel: WS_CHANNELS.serverWelcome,
      data: {
        cwd: "/tmp/workspace",
        projectName: "workspace",
      },
    });

    if (!("type" in parsed) || parsed.type !== "push") {
      assert.fail("expected websocket response to decode as a push envelope");
    }

    assert.strictEqual(parsed.type, "push");
    assert.strictEqual(parsed.sequence, 1);
    assert.strictEqual(parsed.channel, WS_CHANNELS.serverWelcome);
  }),
);

it.effect("accepts server.keepAwakeUpdated push envelopes", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(WsResponse, {
      type: "push",
      sequence: 4,
      channel: WS_CHANNELS.serverKeepAwakeUpdated,
      data: {
        keepAwake: { available: true, mode: "agent", active: false, error: null },
      },
    });

    if (!("type" in parsed) || parsed.type !== "push") {
      assert.fail("expected websocket response to decode as a push envelope");
    }

    assert.strictEqual(parsed.channel, WS_CHANNELS.serverKeepAwakeUpdated);
    if (parsed.channel === WS_CHANNELS.serverKeepAwakeUpdated) {
      assert.strictEqual(parsed.data.keepAwake.mode, "agent");
    }
  }),
);

it.effect("rejects push envelopes when channel payload does not match the channel schema", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decode(WsResponse, {
        type: "push",
        sequence: 2,
        channel: ORCHESTRATION_WS_CHANNELS.domainEvent,
        data: {
          cwd: "/tmp/workspace",
          projectName: "workspace",
        },
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);
