# T2MinePlanner

Planejamento e simulação de produção para mina e planta de beneficiamento: premissas operacionais, dimensionamento de frota por rota, lançamento da produção realizada, replanejamento e cenários.

A partir da versão 3, o sistema é **multiempresa**: cada empresa tem seus próprios usuários e dados, isolados no banco.

## Como funciona o acesso

| Quem | O que faz |
| --- | --- |
| **Empresa nova** | Cadastra-se em `/cadastro` (empresa + administrador) e ganha 30 dias de teste. |
| **Administrador** | Edita planos, convida pessoas por link (`/convite/...`), muda papéis e remove usuários em **Empresa e usuários**. |
| **Planejador** | Cria e edita planos, lançamentos e cenários. |
| **Leitor** | Só consulta (os campos ficam desabilitados). |
| **Dono do sistema** | Vê todas as empresas em **Dono do sistema** e libera, bloqueia ou estende o teste. Bloquear não apaga dados. |

Teste vencido ou empresa bloqueada: os usuários veem uma tela de acesso suspenso e o banco recusa leitura e gravação dos planos (RLS).

## Stack

- React 19 + Vite 6 + Tailwind CSS 4 + React Router 7
- Supabase (Auth + Postgres com Row Level Security)
- Vercel (hospedagem, com preview automático por branch)
- Vitest (testes dos cálculos)

## Configuração (uma vez)

1. **Supabase** — crie um projeto (região São Paulo). No **SQL Editor**, rode o arquivo
   `supabase/migrations/20261017000000_multiempresa.sql` inteiro.
2. **Auth → URL Configuration** — em *Site URL* coloque a URL do Vercel e em *Redirect URLs* adicione
   `https://SEU-APP.vercel.app/**`, `https://*-SEU-USUARIO.vercel.app/**` (previews) e `http://localhost:3000/**`.
3. **Variáveis** — copie `.env.example` para `.env.local` e preencha `VITE_SUPABASE_URL` e
   `VITE_SUPABASE_ANON_KEY` (*Project Settings → API*). No Vercel, cadastre as mesmas em
   *Settings → Environment Variables* (Production e Preview) e faça um novo deploy.
4. **Seu acesso de dono** — cadastre-se no app e depois rode no SQL Editor:
   ```sql
   update public.profiles set is_platform_owner = true where email = 'seu@email.com';
   ```

## Rodar localmente

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # testes dos cálculos e utilitários
npm run lint     # verificação de tipos
npm run build
```

## Estrutura

```
src/
  App.tsx              rotas e guardas (login, empresa liberada, admin, dono)
  auth/                sessão, perfil, empresas do usuário e empresa atual
  lib/                 cliente Supabase, tipos do banco, formatação
  pages/               login, cadastro, senha, convite, empresa, dono, telas de status
  planner/             tela de planejamento e salvamento automático no banco
  components/          telas do simulador (dashboard, rotas, premissas, ...) e UI comum
  utils/calculations   motor de cálculo (com testes)
supabase/
  migrations/          esquema, funções e políticas RLS
  tests/               teste de isolamento entre empresas (Postgres puro)
```

### Dados antigos

Quem usava a versão sem login tinha os dados só no navegador. Ao entrar pela primeira vez, o app oferece **Importar dados** para levar esse planejamento ao plano da empresa.

### Testar as políticas do banco

```bash
psql -d banco_de_teste -f supabase/tests/00_auth_stub.sql \
  -f supabase/migrations/20261017000000_multiempresa.sql \
  -f supabase/tests/01_rls_isolamento.sql
```
O script simula duas empresas e verifica isolamento, papéis, bloqueio e teste expirado.
