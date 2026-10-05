import { Component, type ErrorInfo, type ReactNode } from "react";

/** Last line of defence: a render error shows a recoverable message instead of a blank page.
 * The ledger is in IndexedDB, so a crash in the UI cannot lose it. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI error", error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main>
        <div className="banner bad" role="alert">
          <h1 style={{ fontSize: "1.2rem" }}>Something went wrong</h1>
          <p>
            The screen failed to draw. Your ledger is stored safely in this browser and has not been changed.
          </p>
          <p className="small">{this.state.error.message}</p>
          <button className="btn" onClick={() => window.location.reload()}>
            Reload
          </button>{" "}
          <a className="btn" href="#/">
            Go to the ledger
          </a>
        </div>
      </main>
    );
  }
}
