type DiagnosticEvent = Record<string, string | number | boolean | null>;

type DiagnosticSink = {
  record: (label: string, value: unknown, extra?: Record<string, unknown>) => void;
  identify: (value: object) => number | null;
};

// Isolated synthetic-test diagnostic. The dependency copy reports only scalar
// values it already holds; no observer, listener, layout read or scroll is added.
export function beginTranscriptFollowTrace() {
  const host = globalThis as typeof globalThis & {
    __SYNARA_FOLLOW_DIAGNOSTIC_TRACE__?: DiagnosticSink;
  };
  if (host.__SYNARA_FOLLOW_DIAGNOSTIC_TRACE__)
    throw new Error("A transcript diagnostic trace is already active.");
  const states = new WeakMap<object, number>();
  const first: DiagnosticEvent[] = [];
  const recent: DiagnosticEvent[] = [];
  const resets: DiagnosticEvent[] = [];
  let stateCount = 0;
  let sequence = 0;
  let recentIndex = 0;
  let errors = 0;
  let phase = "initial-growth";
  const scalarKeys = [
    "scroll",
    "scrollPending",
    "scrollPrev",
    "lastNativeScroll",
    "scrollLength",
    "totalSize",
    "hasScrolled",
    "scrollProcessingEnabled",
    "dataChangeNeedsScrollUpdate",
    "didFinishInitialScroll",
    "adjustingFromInitialMount",
    "pendingMaintainScrollAtEnd",
  ] as const;
  const sink: DiagnosticSink = {
    identify: (value) => states.get(value) ?? null,
    record: (label, value, extra = {}) => {
      try {
        const event: DiagnosticEvent = {
          sequence: sequence++,
          time: Math.round(performance.now() * 10) / 10,
          label,
          phase,
        };
        if (value !== null && typeof value === "object") {
          if (!states.has(value)) states.set(value, ++stateCount);
          event.stateId = states.get(value)!;
          const state = value as Record<string, unknown>;
          for (const key of scalarKeys) {
            const item = state[key];
            if (item === null || typeof item === "number" || typeof item === "boolean")
              event[key] = item;
          }
          const props = state.props as Record<string, unknown> | undefined;
          event.maintainScrollAtEnd = Boolean(props?.maintainScrollAtEnd);
          event.itemCount = Array.isArray(props?.data) ? props.data.length : null;
        }
        for (const key of [
          "next",
          "offset",
          "contentHeight",
          "resolvedOffset",
          "syncObservedOffset",
          "context",
          "enabled",
        ]) {
          const item = extra[key];
          if (item === null || typeof item === "number" || typeof item === "boolean")
            event[key] = item;
        }
        if (first.length < 96) first.push(event);
        else {
          recent[recentIndex] = event;
          recentIndex = (recentIndex + 1) % 384;
        }
        // Preserve the bounded discriminating transition even if routine native
        // events fill the ring before the final unchanged assertion completes.
        if (event.next === 0 && typeof event.scroll === "number" && event.scroll > 1_000) {
          if (resets.length < 16) resets.push(event);
        }
      } catch {
        // Diagnostics must never interrupt the dependency's original operation.
        errors += 1;
      }
    },
  };
  host.__SYNARA_FOLLOW_DIAGNOSTIC_TRACE__ = sink;
  return {
    mark: (label: "before-thread-switch" | "remounted" | "final-growth" | "final-settle") => {
      phase = label;
      sink.record("phase", null);
    },
    finish: () => {
      if (host.__SYNARA_FOLLOW_DIAGNOSTIC_TRACE__ === sink)
        delete host.__SYNARA_FOLLOW_DIAGNOSTIC_TRACE__;
      const events = Array.from(
        new Map([...first, ...recent, ...resets].map((event) => [event.sequence, event])).values(),
      ).toSorted((left, right) => Number(left.sequence) - Number(right.sequence));
      return { events, totalEvents: sequence, droppedEvents: sequence - events.length, errors };
    },
  };
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
const scalars = (source: Record<string, unknown> | undefined, keys: readonly string[]) =>
  Object.fromEntries(
    keys.flatMap((key) => {
      const value = source?.[key];
      return value === null || ["string", "number", "boolean"].includes(typeof value)
        ? [[key, value]]
        : [];
    }),
  );

// This final geometry/state snapshot executes only after behavior assertions.
export function readTranscriptFollowDiagnostic(node: HTMLElement | null) {
  const result: Record<string, unknown> = {
    native: node
      ? { top: node.scrollTop, height: node.scrollHeight, viewport: node.clientHeight }
      : null,
    layers: [],
  };
  if (!node) return result;
  const fiberKey = Object.getOwnPropertyNames(node).find((key) => key.startsWith("__reactFiber$"));
  let fiber = fiberKey ? record((node as unknown as Record<string, unknown>)[fiberKey]) : undefined;
  const layers: unknown[] = [];
  for (let depth = 0; fiber && depth < 100; depth += 1, fiber = record(fiber.return)) {
    const props = record(fiber.memoizedProps);
    const layer = scalars(props, [
      "followLiveOutput",
      "animateTailAnchorSlide",
      "initialScrollAtEnd",
      "maintainScrollAtEnd",
      "maintainScrollAtEndThreshold",
      "isWorking",
    ]);
    if (Object.keys(layer).length > 0) layers.push({ depth, ...layer });
    const context = record(props?.value);
    const state = record(context?.state);
    const signals = context?.values;
    if (!state || !(signals instanceof Map)) continue;
    const stateProps = record(state.props);
    const scroller = record(record(state.refScroller)?.current);
    result.list = {
      contextDepth: depth,
      traceStateId: (
        globalThis as typeof globalThis & {
          __SYNARA_FOLLOW_DIAGNOSTIC_TRACE__?: DiagnosticSink;
        }
      ).__SYNARA_FOLLOW_DIAGNOSTIC_TRACE__?.identify(state),
      scrollerMatchesNode:
        typeof scroller?.getScrollableNode === "function"
          ? scroller.getScrollableNode() === node
          : null,
      scrollerOffset:
        typeof scroller?.getCurrentScrollOffset === "function"
          ? scroller.getCurrentScrollOffset()
          : null,
      state: scalars(state, [
        "scroll",
        "scrollPending",
        "scrollPrev",
        "lastNativeScroll",
        "lastNativeScrollTime",
        "scrollProcessingEnabled",
        "hasScrolled",
        "dataChangeNeedsScrollUpdate",
        "ignoreScrollFromMVCPIgnored",
        "scrollLength",
        "totalSize",
        "queuedInitialLayout",
        "didContainersLayout",
        "didFinishInitialScroll",
        "maintainingScrollAtEnd",
        "pendingMaintainScrollAtEnd",
        "adjustingFromInitialMount",
        "scrollForNextCalculateItemsInView",
      ]),
      signals: Object.fromEntries(
        [
          "isAtEnd",
          "isWithinMaintainScrollAtEndThreshold",
          "readyToRender",
          "totalSize",
          "footerSize",
          "headerSize",
          "stylePaddingTop",
          "scrollSize",
          "scrollAdjust",
          "scrollAdjustPending",
          "numContainers",
        ].map((key) => [key, signals.get(key)]),
      ),
      props: scalars(stateProps, ["maintainScrollAtEndThreshold", "initialScrollAtEnd"]),
      maintainScrollAtEnd:
        stateProps?.maintainScrollAtEnd === false
          ? false
          : scalars(record(stateProps?.maintainScrollAtEnd), [
              "animated",
              "onDataChange",
              "onItemLayout",
              "onFooterLayout",
            ]),
      maintainVisibleContentPosition: scalars(record(stateProps?.maintainVisibleContentPosition), [
        "data",
        "size",
      ]),
      pendingNativeAdjustment: Boolean(state.pendingNativeMVCPAdjust),
      ignoredNativeScrollRange: scalars(record(state.ignoreScrollFromMVCP), ["lt", "gt"]),
      initialScrollSession: scalars(record(state.initialScrollSession), ["kind"]),
      scrollHistory: Array.isArray(state.scrollHistory)
        ? state.scrollHistory.slice(-5).map((entry) => scalars(record(entry), ["scroll", "time"]))
        : null,
      scrollingTo: scalars(record(state.scrollingTo), [
        "index",
        "offset",
        "animated",
        "isInitialScroll",
      ]),
      initialScroll: scalars(record(state.initialScroll), ["index", "offset", "animated"]),
      itemCount: Array.isArray(stateProps?.data) ? stateProps.data.length : null,
    };
  }
  result.layers = layers;
  return result;
}
