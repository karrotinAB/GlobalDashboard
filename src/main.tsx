import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { DATA_MODE, StoreProvider } from './data/store';
import AuthGate from './components/AuthGate';
import './styles.css';

const app = (
  <StoreProvider>
    <App />
  </StoreProvider>
);

createRoot(document.getElementById('root')!).render(<StrictMode>{DATA_MODE === 'local' ? app : <AuthGate>{app}</AuthGate>}</StrictMode>);
