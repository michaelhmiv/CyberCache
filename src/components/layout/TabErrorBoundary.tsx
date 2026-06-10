import React from 'react';

interface TabErrorBoundaryProps {
  /** Which surface failed — shown to the user. */
  surface: string;
  children: React.ReactNode;
}

interface TabErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Route-level error boundary for tab screens.
 *
 * A render bug in any single tab (Dashboard, Action, Profile, etc.) must not
 * white-screen the entire app. This boundary catches render errors and shows
 * which surface failed, with a prompt to check the browser console/logs.
 *
 * It is NOT a substitute for correctness — it's a containment fence.
 * If you see this fallback, fix the underlying type/state mismatch.
 */
export class TabErrorBoundary extends React.Component<
  TabErrorBoundaryProps,
  TabErrorBoundaryState
> {
  constructor(props: TabErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): TabErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(
      `[TabErrorBoundary] ${this.props.surface} render failed:`,
      error,
      info.componentStack,
    );
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="rounded-2xl border-2 border-red/30 bg-red/5 p-6">
            <div className="text-sm font-black text-red">
              Render Error — {this.props.surface}
            </div>
            <div className="mt-2 max-w-xs text-xs leading-relaxed text-text-muted">
              The {this.props.surface} screen hit a render error. Check the
              browser console (F12 → Console) for details. The rest of the app
              is unaffected.
            </div>
            {this.state.error && (
              <div className="mt-3 overflow-auto rounded border border-border bg-surface p-2 text-left font-mono text-[10px] text-red">
                {this.state.error.message}
              </div>
            )}
            <button
              type="button"
              onClick={this.handleRetry}
              className="mt-4 rounded-lg border border-border bg-surface-raised px-4 py-2 text-xs font-bold text-text-primary"
            >
              Retry {this.props.surface}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
