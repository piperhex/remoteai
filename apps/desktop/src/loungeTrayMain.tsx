import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LoungeTray } from './lounge/tray/LoungeTray';
import { installBrowserDefaultsGuard } from '../../../shared/browser/installBrowserDefaultsGuard';

const stopBrowserDefaultsGuard = installBrowserDefaultsGuard();
if (import.meta.hot) import.meta.hot.dispose(stopBrowserDefaultsGuard);
createRoot(document.getElementById('root')!).render(<StrictMode><LoungeTray /></StrictMode>);
