import { spaceQueryClient } from "@hatch/space-sdk/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";

const rootEl = document.querySelector<HTMLElement>("[data-generated-space-root]");
if (!rootEl) {
  throw new Error("missing generated space root element");
}

class AppErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{
  override state={failed:false};
  static getDerivedStateFromError(){return{failed:true}}
  override render(){
    return this.state.failed
      ? <div className="boot error" role="alert"><strong>RetailIQ could not finish loading.</strong><span>Your session is safe. Reload to try again.</span><button onClick={()=>window.location.reload()}>Reload</button></div>
      : this.props.children;
  }
}

// If you edit this file: keep `<QueryClientProvider client={spaceQueryClient}>`
// wrapping the app (every space shares the SDK's QueryClient), and keep
// BOTH the `hatch-space-root` class AND the `data-hatch-space-root`
// attribute on the outer div. The SDK styles select on
// `.hatch-space-root[data-hatch-space-root]` to apply mobile safe-area
// insets (notches, gesture bars, etc.), correct viewport sizing, and the
// hosting header/chrome offsets — dropping either breaks layout silently.
createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={spaceQueryClient}>
      <div className="hatch-space-root" data-hatch-space-root>
        <AppErrorBoundary><App /></AppErrorBoundary>
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
