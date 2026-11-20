import { createRoot } from 'react-dom/client';
import { ArrowLeftRight } from 'lucide-react';
import { ConfirmationProvider } from './Confirmation';
import { QuickTransfer } from './QuickTransfer';
import './theme-tokens.css';
import './collaboration.css';

createRoot(document.getElementById('root')!).render(
  <ConfirmationProvider>
    <main className="collab-page" data-module="transfer">
      <header className="collab-header">
        <div className="collab-identity">
          <span className="collab-emblem">
            <ArrowLeftRight size={25} />
          </span>
          <h1>局域网快传</h1>
        </div>
      </header>
      <QuickTransfer active edit quickLink />
    </main>
  </ConfirmationProvider>,
);
