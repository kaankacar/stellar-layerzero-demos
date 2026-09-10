import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('page crashed', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="card border-danger/40 p-6">
          <div className="mb-2 text-lg font-semibold text-danger">This page hit an unexpected error</div>
          <p className="mb-3 text-sm text-muted">The rest of the site still works. The error was:</p>
          <pre className="overflow-auto rounded-lg bg-code-bg p-3 text-xs">{this.state.error.message}</pre>
          <button className="btn mt-4" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
