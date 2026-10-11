import { toastManager } from "../components/ui/toast";

/** Read-only instrumentation for the two original retry/exit regressions. */
export function startToastRetryDiagnostic(input: {
  scope: string;
  counters: () => Record<string, number | string | null>;
}) {
  const startedAt = performance.now();
  const records: unknown[] = [];
  const identities = new WeakMap<Element, number>();
  let nextIdentity = 1;
  let attempt = -1;
  let dropped = 0;
  let finished = false;
  const viewportSelector = '[data-slot="toast-viewport"]';

  const identity = (element: Element) => {
    let value = identities.get(element);
    if (value === undefined) {
      value = nextIdentity++;
      identities.set(element, value);
    }
    return value;
  };
  const geometry = (element: Element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      node: identity(element),
      connected: element.isConnected,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      inViewport:
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= innerHeight &&
        rect.right <= innerWidth,
      transform: style.transform,
      opacity: style.opacity,
      visibility: style.visibility,
      pointerEvents: style.pointerEvents,
      transition: style.transition,
      attributes: Object.fromEntries(
        element
          .getAttributeNames()
          .filter((name) => name.startsWith("data-") || name === "aria-hidden")
          .map((name) => [name, element.getAttribute(name)]),
      ),
    };
  };
  const record = (entry: Record<string, unknown>) => {
    if (finished) return;
    if (records.length >= 192) {
      dropped += 1;
      return;
    }
    records.push({ ms: performance.now() - startedAt, attempt, ...entry });
  };
  const snapshot = (reason: string) => {
    if (finished) return;
    if (records.length >= 192) {
      dropped += 1;
      return;
    }
    try {
      const viewports = [...document.querySelectorAll(viewportSelector)].slice(0, 2);
      record({
        reason,
        counters: input.counters(),
        viewport: { width: innerWidth, height: innerHeight },
        toasts: viewports.flatMap((viewport) =>
          [...viewport.querySelectorAll('[data-slot="toast-title"]')].slice(0, 6).map((title) => {
            const root = title.closest("[data-position]");
            const button = root?.querySelector('[data-slot="toast-action"]');
            return {
              // Only this controlled fixture's toast labels, never application payloads.
              title: title.textContent,
              domId: root?.id ?? null,
              root: root ? geometry(root) : null,
              action: button ? geometry(button) : null,
            };
          }),
        ),
      });
    } catch (cause) {
      record({ reason: "observer-error", detail: String(cause) });
    }
  };

  // The pinned Base UI 1.7.0 type exposes this internal provider subscription.
  // It observes requests only: requested transitionStatus is not a store/DOM state.
  // Do not replace or wrap add/close/update, and never infer ID from a DOM index.
  const unsubscribe = toastManager[" subscribe"](({ action, options }) => {
    const value = options as Record<string, unknown> | undefined;
    record({
      reason: "manager-request",
      action,
      toastId: typeof value?.id === "string" ? value.id : null,
      title: typeof value?.title === "string" ? value.title : null,
      requestedTransition:
        typeof value?.transitionStatus === "string" ? value.transitionStatus : null,
      timeout: typeof value?.timeout === "number" ? value.timeout : null,
    });
  });
  const belongsToToast = (node: Node) =>
    node instanceof Element &&
    (node.closest(viewportSelector) !== null || node.querySelector(viewportSelector) !== null);
  const observer = new MutationObserver((mutations) => {
    if (
      mutations.some(
        (mutation) =>
          belongsToToast(mutation.target) ||
          [...mutation.addedNodes, ...mutation.removedNodes].some(belongsToToast),
      )
    ) {
      snapshot("toast-dom-mutation");
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      "data-starting-style",
      "data-ending-style",
      "data-expanded",
      "data-limited",
      "aria-hidden",
      "style",
    ],
  });
  const onTransition = (event: Event) => {
    if (event.target instanceof Element && event.target.closest(viewportSelector)) {
      snapshot(event.type);
    }
  };
  const transitionEvents = ["transitionrun", "transitionend", "transitioncancel"];
  for (const name of transitionEvents) document.addEventListener(name, onTransition, true);
  snapshot("attached");

  return {
    attempt(value: number) {
      attempt = value;
      snapshot("before-overflow");
    },
    snapshot,
    finish() {
      snapshot("finally");
      finished = true;
      observer.disconnect();
      unsubscribe();
      for (const name of transitionEvents) document.removeEventListener(name, onTransition, true);
      console.log(
        `SYNARA_TOAST_RETRY_TRACE ${JSON.stringify({ scope: input.scope, records, dropped })}`,
      );
    },
  };
}
