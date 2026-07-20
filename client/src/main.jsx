import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Landing from './Landing.jsx';
import Why from './Why.jsx';
import './styles.css';

// `/` is the landing; `/why` is the story; the board lives at `/app` (resolves
// the default map -> `/map/:id`) and at shareable `/map/:id` links.
const path = window.location.pathname;
const isBoard = path === '/app' || path.startsWith('/map/');
const Root = isBoard ? App : path === '/why' ? Why : Landing;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
