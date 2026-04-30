import React from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import { KnowledgeApp } from './KnowledgeApp';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <KnowledgeApp />
  </React.StrictMode>
);
