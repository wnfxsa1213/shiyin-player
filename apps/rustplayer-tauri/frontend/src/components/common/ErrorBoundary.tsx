import { Component, type ReactNode, type ErrorInfo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ipc } from '@/lib/ipc';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
    const detail = [
      error?.stack ? `stack:\n${error.stack}` : '',
      info?.componentStack ? `componentStack:\n${info.componentStack}` : '',
    ].filter(Boolean).join('\n\n');
    ipc.clientLog('error', `ErrorBoundary caught: ${error?.message ?? String(error)}\n\n${detail}`);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
          <AlertTriangle size={48} strokeWidth={1} className="text-warning opacity-60" aria-hidden="true" />
          <p className="text-text-secondary text-sm">页面出现了问题</p>
          <p className="text-text-tertiary text-xs max-w-md text-center">
            发生了意外错误，请尝试重试
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 bg-bg-secondary text-text-primary rounded-lg text-sm hover:bg-bg-hover transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
