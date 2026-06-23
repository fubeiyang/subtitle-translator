import React from 'react';
import ReactDOM from 'react-dom/client';
import OverlayApp from './App';
import '../styles/overlay.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OverlayApp />
  </React.StrictMode>
);
