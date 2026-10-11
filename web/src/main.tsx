import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppProviders } from './app/providers';
import { AppRoutes } from './app/router';
import { createServices } from './app/services';
import { runtimeConfig } from './app/config';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import './styles/globals.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('App root is required.');
const root = createRoot(rootElement);

createServices()
  .then((service) => {
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <AppProviders service={service}>
            <BrowserRouter>
              <AppRoutes isMock={runtimeConfig.apiMode === 'mock'} />
            </BrowserRouter>
          </AppProviders>
        </ErrorBoundary>
      </StrictMode>,
    );
  })
  .catch(() => {
    root.render(
      <main className="container query-state" role="alert">
        <h1>应用暂时无法启动</h1>
        <p>请检查公开运行时配置后重试。不会回退到演示数据。</p>
      </main>,
    );
  });
