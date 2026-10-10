import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThreadId } from "@synara/contracts";
import { FloatingBrowserPanel } from "../../src/components/chat/FloatingBrowserPanel";
import BrowserPanel from "../../src/components/BrowserPanel";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import "../../src/index.css";

const threadId = ThreadId.makeUnsafe("native-ui-evidence");
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function NativeUiEvidence() {
  const [mode, setMode] = useState<"floating" | "sidebar" | "closed">("floating");
  // A test shell surrounds the unchanged production components. No browser
  // markup, page pixels, native controls or product lifecycle is mocked here.
  Object.assign(window, { __synaraNativeUiMode: mode });
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <main style={{ width: "100vw", height: "100vh", display: "flex" }}>
          <section style={{ flex: 1, position: "relative", minWidth: 0, height: "100%" }}>
            <header
              style={{ height: 48, padding: 16, borderBottom: "1px solid var(--color-border)" }}
            >
              Browser handoff review
            </header>
            <p style={{ padding: 24 }}>
              The browser below is the production panel with a real Electron page.
            </p>
            <form
              data-chat-composer-form
              style={{
                position: "absolute",
                left: 24,
                right: 24,
                bottom: 24,
                height: 80,
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                padding: 16,
              }}
            >
              <label>
                Review draft{" "}
                <input aria-label="Review draft" defaultValue="Continue reviewing this page" />
              </label>
            </form>
            {mode === "floating" ? (
              <FloatingBrowserPanel
                threadId={threadId}
                onPopToSidebar={() => setMode("sidebar")}
                onClose={() => setMode("closed")}
              />
            ) : null}
          </section>
          {mode === "sidebar" ? (
            <aside
              style={{ width: 480, height: "100%", borderLeft: "1px solid var(--color-border)" }}
            >
              <BrowserPanel
                mode="sidebar"
                threadId={threadId}
                onClosePanel={() => setMode("closed")}
              />
            </aside>
          ) : null}
        </main>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")!).render(<NativeUiEvidence />);
