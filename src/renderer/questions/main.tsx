import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../shared/queryClient';
import QuestionsApp from './App';
import { LanguageProvider } from '../shared/i18n';
import { initFontScale } from '../shared/fontScale';
import '../styles/globals.css';

const queryClient = createQueryClient();
document.documentElement.classList.add('dark');
initFontScale();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <QuestionsApp />
      </QueryClientProvider>
    </LanguageProvider>
  </React.StrictMode>
);
