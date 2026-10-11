import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThreadId } from "@synara/contracts";
import BrowserPanel from "../../src/components/BrowserPanel";
import { Button } from "../../src/components/ui/button";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import { readNativeApi } from "../../src/nativeApi";
import { useBrowserStateStore } from "../../src/browserStateStore";
import "../../src/index.css";

declare global {
  interface Window {
    __synaraStackShell: { onShow(listener: () => void): () => void };
  }
}
const threadId = ThreadId.makeUnsafe("native-stack-evidence");
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function NativeStackShell() {
  const [shown, setShown] = useState(false);
  const reveal = useCallback(async () => {
    const api = readNativeApi();
    if (!api) throw new Error("Native browser fixture API is unavailable");
    const state = await api.browser.open({ threadId });
    // Hydrate the production store before mounting the panel so its first
    // bounds measurement sees the actual native surface, just as an existing
    // workspace opened by the application does. No runtime is claimed here.
    useBrowserStateStore.getState().upsertThreadState(state);
    setShown(true);
  }, []);
  useEffect(() => window.__synaraStackShell.onShow(() => void reveal()), [reveal]);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <main
          data-synara-native-stack-host
          style={{ width: "100vw", height: "100vh", display: "flex" }}
        >
          <section
            style={{
              width: 260,
              padding: 24,
              flexShrink: 0,
              borderRight: "1px solid var(--color-border)",
            }}
          >
            <h1 className="text-ui-lg">Browser workspace review</h1>
            <p className="text-ui" style={{ marginTop: 16, marginBottom: 24 }}>
              Production browser panel and native pages in an isolated acceptance fixture.
            </p>
            <Button onClick={() => void reveal()}>Show browser</Button>
            <Button variant="outline" onClick={() => setShown(false)} style={{ marginTop: 12 }}>
              Hide browser
            </Button>
            <p className="text-ui-sm" style={{ marginTop: 24 }}>
              The page content is synthetic. No provider account is connected.
            </p>
          </section>
          <aside style={{ minWidth: 0, flex: 1, height: "100%" }}>
            {shown ? (
              <BrowserPanel
                mode="sidebar"
                threadId={threadId}
                onClosePanel={() => setShown(false)}
              />
            ) : null}
          </aside>
        </main>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")!).render(<NativeStackShell />);
