import { useState } from 'react';
import MainPage from './pages/MainPage';
import SettingsPage from './pages/SettingsPage';
import TitleBar from './components/TitleBar';

export type Page = 'main' | 'settings';

export default function App() {
  const [page, setPage] = useState<Page>('main');

  return (
    <div className="app-window">
      <TitleBar onSettings={() => setPage('settings')} showSettings={page === 'main'} />
      <div className="app-content">
        {page === 'main' ? (
          <MainPage />
        ) : (
          <SettingsPage onBack={() => setPage('main')} />
        )}
      </div>
    </div>
  );
}
