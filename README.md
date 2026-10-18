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
- Neon: Postgres (região São Paulo), Neon Auth (Better Auth) e Data API com Row Level Security
- SDK `@neondatabase/neon-js` (login no estilo Supabase + consultas à Data API)
- Vercel (hospedagem, com preview automático por branch)
- Vitest (testes dos cálculos)

## Configuração (uma vez)

1. **Neon** — no projeto, ative **Better Auth** e **Data API** (com "Use Neon Auth" e "Grant public schema access").
2. **Banco** — em **SQL Editor**, rode o arquivo `db/schema.sql` inteiro. Depois, em **Data API**, clique em
   **Refresh schema cache**.
3. **Better Auth → Configure Auth** — em *Trusted domains*, adicione `http://localhost:3000`, a URL do app no
   Vercel e `https://*-muxibas-projects.vercel.app` (previews).
4. **Variáveis** — copie `.env.example` para `.env.local` e preencha `VITE_NEON_AUTH_URL` e
   `VITE_NEON_DATA_API_URL`. No Vercel, cadastre as mesmas em *Settings → Environment Variables*
   (Production e Preview) e faça um novo deploy.
5. **Seu acesso de dono** — cadastre-se no app e depois rode no SQL Editor:
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
  lib/                 cliente Neon (login + Data API), tipos do banco, formatação
  pages/               login, cadastro, senha, convite, empresa, dono, telas de status
  planner/             tela de planejamento e salvamento automático no banco
  components/          telas do simulador (dashboard, rotas, premissas, ...) e UI comum
  utils/calculations   motor de cálculo (com testes)
db/
  schema.sql           tabelas, funções (RPC) e políticas RLS
  tests/               teste de isolamento entre empresas (Postgres puro, simulando o Neon)
```

### Dados antigos

Quem usava a versão sem login tinha os dados só no navegador. Ao entrar pela primeira vez, o app oferece **Importar dados** para levar esse planejamento ao plano da empresa.

### Testar as políticas do banco

```bash
psql -d banco_de_teste -f db/tests/00_neon_stub.sql \
  -f db/schema.sql \
  -f db/tests/01_rls_isolamento.sql
```
O script simula duas empresas e verifica isolamento, papéis, bloqueio e teste expirado.
