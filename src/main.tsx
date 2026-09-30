import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import { Toaster } from 'sonner';
import { App } from './app/App';
import { applyTheme, UiStateProvider } from './app/ui-state';
import { AppDataProvider } from './data/context';
import './index.css';

try {
  applyTheme(JSON.parse(localStorage.getItem('ui.theme') ?? '"system"'));
} catch {
  applyTheme('system');
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppDataProvider>
        <UiStateProvider>
          <HashRouter>
            <App />
          </HashRouter>
          <Toaster position="bottom-right" richColors closeButton toastOptions={{ style: { fontFamily: 'Inter Variable, sans-serif' } }} />
        </UiStateProvider>
      </AppDataProvider>
    </QueryClientProvider>
  </StrictMode>,
);
