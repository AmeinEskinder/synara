// Isolated synthetic-test diagnostic. It executes only after all behavior assertions.
// No observer/listener is installed and no production source is changed.
export function readTranscriptFollowDiagnostic(node: HTMLElement | null) {
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
    result.list = {
      state: scalars(state, [
        "scroll",
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
