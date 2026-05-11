import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../shared/queryClient';
import DiagnosisApp from './App';
import '../styles/globals.css';

const queryClient = createQueryClient();
document.documentElement.classList.add('dark');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <DiagnosisApp />
    </QueryClientProvider>
  </React.StrictMode>
);
