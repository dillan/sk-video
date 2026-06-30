import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, loadTheme } from './lib/theme';
import { applyDensity, loadDensity } from './lib/density';
import './theme.css';

// Apply the saved theme + density before first paint so there's no flash of the defaults.
applyTheme(loadTheme());
applyDensity(loadDensity());

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
