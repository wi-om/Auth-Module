import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Toaster
      position="top-right"
      toastOptions={{
        className: 'text-sm font-medium',
        style: {
          background: '#fff',
          color: '#0f172a',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)',
        },
        success: {
          iconTheme: { primary: '#4f46e5', secondary: '#fff' },
        },
        error: {
          duration: 5000,
          iconTheme: { primary: '#e11d48', secondary: '#fff' },
        },
      }}
    />
  </StrictMode>
);
