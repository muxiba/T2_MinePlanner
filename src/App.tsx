import React, { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { isSupabaseConfigured } from '@/lib/supabase';
import { isCompanyUsable } from '@/lib/db-types';
import { FullScreenLoader } from '@/components/ui';
import LoginPage from '@/pages/LoginPage';
import SignUpPage from '@/pages/SignUpPage';
import { ForgotPasswordPage, ResetPasswordPage } from '@/pages/PasswordPages';
import AcceptInvitePage from '@/pages/AcceptInvitePage';
import { BlockedPage, NoCompanyPage, SetupMissingPage } from '@/pages/StatusPages';

// Telas pesadas carregadas sob demanda (gráficos, PDF etc.)
const PlannerPage = lazy(() => import('@/planner/PlannerPage'));
const CompanyPage = lazy(() => import('@/pages/CompanyPage'));
const OwnerPage = lazy(() => import('@/pages/OwnerPage'));

/** Exige login. */
const RequireAuth: React.FC = () => {
  const { loading, session } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!session) {
    const next = location.pathname + location.search;
    return <Navigate to={next === '/' ? '/entrar' : `/entrar?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Outlet />;
};

/** Exige uma empresa liberada (ativa ou em teste válido). */
const RequireCompany: React.FC = () => {
  const { current } = useAuth();
  if (!current) return <NoCompanyPage />;
  if (!isCompanyUsable(current.company)) return <BlockedPage />;
  // key: ao trocar de empresa, as telas são remontadas com os dados da nova empresa
  return (
    <React.Fragment key={current.company_id}>
      <Outlet />
    </React.Fragment>
  );
};

const RequireAdmin: React.FC = () => {
  const { role } = useAuth();
  return role === 'admin' ? <Outlet /> : <Navigate to="/" replace />;
};

const RequireOwner: React.FC = () => {
  const { isOwner } = useAuth();
  return isOwner ? <Outlet /> : <Navigate to="/" replace />;
};

const Root: React.FC = () => (
  <AuthProvider>
    <Suspense fallback={<FullScreenLoader />}>
      <Outlet />
    </Suspense>
  </AuthProvider>
);

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/entrar', element: <LoginPage /> },
      { path: '/cadastro', element: <SignUpPage /> },
      { path: '/recuperar-senha', element: <ForgotPasswordPage /> },
      { path: '/redefinir-senha', element: <ResetPasswordPage /> },
      { path: '/convite/:token', element: <AcceptInvitePage /> },
      {
        element: <RequireAuth />,
        children: [
          // O painel do dono funciona mesmo se a empresa dele estiver bloqueada
          { element: <RequireOwner />, children: [{ path: '/dono', element: <OwnerPage /> }] },
          {
            element: <RequireCompany />,
            children: [
              { path: '/', element: <PlannerPage /> },
              { element: <RequireAdmin />, children: [{ path: '/empresa', element: <CompanyPage /> }] },
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

const App: React.FC = () => (isSupabaseConfigured ? <RouterProvider router={router} /> : <SetupMissingPage />);

export default App;
