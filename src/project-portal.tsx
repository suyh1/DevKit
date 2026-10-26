import { createRoot } from 'react-dom/client';
import { ConfirmationProvider } from './Confirmation';
import SharedPortal from './SharedPortal';
import './theme.css';
import './workspace-portal.css';
createRoot(document.getElementById('root')!).render(<ConfirmationProvider><SharedPortal /></ConfirmationProvider>);
