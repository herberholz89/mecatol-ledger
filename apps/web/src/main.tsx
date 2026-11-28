import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import './index.css';
import { Layout } from './Layout.js';
import { AccountPage } from './pages/AccountPage.js';
import { AdminPage } from './pages/AdminPage.js';
import { GameDetailPage } from './pages/GameDetailPage.js';
import { GameFormPage } from './pages/GameFormPage.js';
import { GamesPage } from './pages/GamesPage.js';
import { HomePage } from './pages/HomePage.js';
import { ImportPage } from './pages/import/ImportPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { SignInPage } from './pages/SignInPage.js';
import { FactionDetailPage } from './pages/stats/FactionDetailPage.js';
import { FactionsPage } from './pages/stats/FactionsPage.js';
import { PlayerDetailPage } from './pages/stats/PlayerDetailPage.js';
import { PlayersPage } from './pages/stats/PlayersPage.js';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
});

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'games', element: <GamesPage /> },
      { path: 'games/new', element: <GameFormPage /> },
      { path: 'games/:id', element: <GameDetailPage /> },
      { path: 'games/:id/edit', element: <GameFormPage /> },
      { path: 'factions', element: <FactionsPage /> },
      { path: 'factions/:id', element: <FactionDetailPage /> },
      { path: 'players', element: <PlayersPage /> },
      { path: 'players/:id', element: <PlayerDetailPage /> },
      { path: 'import', element: <ImportPage /> },
      { path: 'signin', element: <SignInPage /> },
      { path: 'account', element: <AccountPage /> },
      { path: 'admin', element: <AdminPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
