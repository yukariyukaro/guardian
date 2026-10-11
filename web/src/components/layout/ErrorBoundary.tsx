import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    // Never log business payloads, personal data, or stack traces from public UI.
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="container query-state" role="alert">
          <h1>页面暂时无法显示</h1>
          <p>请刷新页面；若问题持续，请稍后重试。</p>
          <a className="button" href="/">
            返回首页
          </a>
        </main>
      );
    }
    return this.props.children;
  }
}
