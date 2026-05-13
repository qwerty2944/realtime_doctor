import React from 'react';
import ReactDOM from 'react-dom/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import DockApp from './App';
import { LanguageProvider } from '../shared/i18n';
import '../styles/globals.css';

document.documentElement.classList.add('dark');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <TooltipProvider delayDuration={150}>
        <DockApp />
      </TooltipProvider>
    </LanguageProvider>
  </React.StrictMode>
);
