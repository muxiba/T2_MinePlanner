import React, { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation, useRouteError } from 'react-router';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { isDbConfigured } from '@/lib/db';
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
  const { current, isOwner } = useAuth();
  if (!current) return <NoCompanyPage />;
  // o dono do sistema tem acesso livre a todas as empresas, mesmo em teste vencido ou bloqueadas
  if (!isOwner && !isCompanyUsable(current.company)) return <BlockedPage />;
  // key: ao trocar de empresa, as telas são remontadas com os dados da nova empresa
  return (
    <React.Fragment key={current.company_id}>
      <Outlet />
    </React.Fragment>
  );
};

const RequireAdmin: React.FC = () => {
  const { role, isOwner } = useAuth();
  return role === 'admin' || isOwner ? <Outlet /> : <Navigate to="/" replace />;
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

/** Erro de rota: versão nova publicada (arquivo antigo sumiu) recarrega sozinho; outros erros mostram uma tela amigável. */
const RouteError: React.FC = () => {
  const err = useRouteError();
  const text = err instanceof Error ? err.message : String((err as { statusText?: string })?.statusText ?? err ?? '');
  const stale = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch/i.test(text);
  React.useEffect(() => {
    if (!stale) return;
    try {
      const last = Number(sessionStorage.getItem('t2-reload-at') || 0);
      if (Date.now() - last < 15000) return;
      sessionStorage.setItem('t2-reload-at', String(Date.now()));
    } catch {
      /* segue */
    }
    window.location.reload();
  }, [stale]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F4F5F7] p-6">
      <div className="max-w-md rounded-2xl border border-black/5 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-bold text-black/80">{stale ? 'Há uma versão nova do T2 Mine Planner' : 'Algo deu errado nesta tela'}</h1>
        <p className="mt-2 text-sm text-black/55">
          {stale ? 'O sistema foi atualizado enquanto esta aba estava aberta. Recarregue para usar a versão nova — seus dados ficam salvos.' : 'Recarregue a página. Se o erro continuar, avise o suporte com a mensagem abaixo.'}
        </p>
        {!stale && <p className="mt-3 rounded-lg bg-black/[0.04] px-3 py-2 text-left font-mono text-xs text-black/60">{text}</p>}
        <button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-xl bg-[#151619] px-4 py-2 text-sm font-semibold text-white hover:bg-black">
          Recarregar
        </button>
      </div>
    </div>
  );
};

const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <RouteError />,
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

const App: React.FC = () => (isDbConfigured ? <RouterProvider router={router} /> : <SetupMissingPage />);

export default App;
