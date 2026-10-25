import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Depois de uma publicação nova, os arquivos da versão antiga somem do servidor.
// Se a aba aberta tentar carregar um deles, recarrega a página uma vez para pegar a versão nova.
window.addEventListener('vite:preloadError', (e) => {
  try {
    const last = Number(sessionStorage.getItem('t2-reload-at') || 0);
    if (Date.now() - last < 15000) return;
    sessionStorage.setItem('t2-reload-at', String(Date.now()));
  } catch {
    /* sem sessionStorage: recarrega mesmo assim */
  }
  e.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
