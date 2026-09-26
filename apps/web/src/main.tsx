import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
import { AuthProvider } from './auth';
import { PrefsProvider } from './theme/prefs';
import { ToastProvider } from './ui/Toast';
import { TooltipProvider } from './ui/Tooltip';
import { loadAppConfig } from './app-config';
import './i18n';
import './index.css';

void loadAppConfig();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <PrefsProvider>
        <AuthProvider>
          <TooltipProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </TooltipProvider>
        </AuthProvider>
      </PrefsProvider>
    </BrowserRouter>
  </StrictMode>,
);
