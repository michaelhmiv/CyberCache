import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[GlobalErrorBoundary] caught error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-bg p-4 text-text-primary">
          <div className="w-full max-w-md space-y-3 rounded-2xl border-2 border-red/40 bg-surface p-4 shadow-[0_12px_32px_rgba(0,0,0,0.75)]">
            <div className="text-center">
              <div className="text-2xl font-black text-red">Runtime Error</div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-text-muted">CyberCache mobile debug</div>
            </div>

            <div className="space-y-1 rounded border border-red/20 bg-bg p-3">
              <div className="text-xs font-bold text-red">{this.state.error?.name ?? 'Error'}</div>
              <div className="break-words text-xs text-text-primary">{this.state.error?.message ?? 'Unknown error'}</div>
            </div>

            {this.state.errorInfo?.componentStack && (
              <div className="max-h-64 overflow-auto rounded border border-border bg-bg p-3">
                <div className="mb-1 text-[10px] font-black uppercase text-text-muted">Component Stack</div>
                <pre className="whitespace-pre-wrap text-[9px] text-text-primary">{this.state.errorInfo.componentStack}</pre>
              </div>
            )}

            {this.state.error?.stack && (
              <div className="max-h-64 overflow-auto rounded border border-border bg-bg p-3">
                <div className="mb-1 text-[10px] font-black uppercase text-text-muted">Stack Trace</div>
                <pre className="whitespace-pre-wrap text-[9px] text-text-primary">{this.state.error.stack}</pre>
              </div>
            )}

            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full rounded-xl bg-amber py-2.5 text-sm font-black text-bg"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
