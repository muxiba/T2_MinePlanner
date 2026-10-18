-- =============================================================================
-- T2MinePlanner — Estrutura multiempresa
-- Empresas (tenants), membros com papéis, convites, planos e cenários.
-- Isolamento por empresa garantido por Row Level Security (RLS).
--
-- Como aplicar: Supabase → SQL Editor → cole este arquivo inteiro → Run.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tabelas
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  email             text not null,
  full_name         text,
  is_platform_owner boolean not null default false,
  created_at        timestamptz not null default now()
);

create table if not exists public.companies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 2 and 120),
  cnpj          text,
  status        text not null default 'trial' check (status in ('trial', 'active', 'blocked')),
  trial_ends_at timestamptz not null default (now() + interval '30 days'),
  notes         text,             -- anotações internas do dono do sistema
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create table if not exists public.company_members (
  company_id uuid not null references public.companies (id) on delete cascade,
  -- referencia profiles (que referencia auth.users) para permitir o join company_members → profiles na API
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       text not null check (role in ('admin', 'planner', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index if not exists company_members_user_idx on public.company_members (user_id);

create table if not exists public.invitations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  email       text not null,
  role        text not null check (role in ('admin', 'planner', 'viewer')),
  token       uuid not null unique default gen_random_uuid(),
  invited_by  uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  expires_at  timestamptz not null default (now() + interval '7 days'),
  created_at  timestamptz not null default now()
);
create index if not exists invitations_company_idx on public.invitations (company_id);

-- Um "plano" = uma simulação/planejamento completo (premissas, rotas, lançamentos).
create table if not exists public.plans (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  name            text not null default 'Plano principal',
  premises        jsonb,
  routes          jsonb,
  production_logs jsonb not null default '{}'::jsonb,
  created_by      uuid references auth.users (id) on delete set null,
  updated_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists plans_company_idx on public.plans (company_id);

create table if not exists public.scenarios (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  plan_id    uuid references public.plans (id) on delete cascade,
  name       text not null,
  premises   jsonb not null,
  routes     jsonb not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists scenarios_company_idx on public.scenarios (company_id);

-- -----------------------------------------------------------------------------
-- Funções auxiliares (security definer evita recursão nas políticas)
-- -----------------------------------------------------------------------------

create or replace function public.is_platform_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_platform_owner from profiles where id = auth.uid()), false);
$$;

create or replace function public.member_role(p_company uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from company_members where company_id = p_company and user_id = auth.uid();
$$;

create or replace function public.is_member(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from company_members where company_id = p_company and user_id = auth.uid());
$$;

-- Empresa liberada = ativa, ou em teste dentro do prazo.
create or replace function public.company_is_usable(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from companies
    where id = p_company
      and (status = 'active' or (status = 'trial' and trial_ends_at > now()))
  );
$$;

create or replace function public.can_read(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_owner()
      or (public.is_member(p_company) and public.company_is_usable(p_company));
$$;

create or replace function public.can_edit(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.member_role(p_company) in ('admin', 'planner')
     and public.company_is_usable(p_company);
$$;

-- -----------------------------------------------------------------------------
-- Novo usuário: cria perfil e, conforme os metadados do cadastro,
-- cria a empresa (usuário vira admin) ou aceita um convite.
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_invite  invitations%rowtype;
  v_meta    jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into profiles (id, email, full_name)
  values (new.id, lower(new.email), nullif(trim(v_meta ->> 'full_name'), ''))
  on conflict (id) do nothing;

  if nullif(v_meta ->> 'invite_token', '') is not null then
    select * into v_invite from invitations
     where token = (v_meta ->> 'invite_token')::uuid
       and accepted_at is null and expires_at > now()
       and lower(email) = lower(new.email);
    if found then
      insert into company_members (company_id, user_id, role)
      values (v_invite.company_id, new.id, v_invite.role)
      on conflict do nothing;
      update invitations set accepted_at = now() where id = v_invite.id;
    end if;
  elsif nullif(trim(v_meta ->> 'company_name'), '') is not null then
    insert into companies (name, cnpj, created_by)
    values (trim(v_meta ->> 'company_name'), nullif(trim(v_meta ->> 'company_cnpj'), ''), new.id)
    returning id into v_company;
    insert into company_members (company_id, user_id, role) values (v_company, new.id, 'admin');
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- RPCs usadas pelo app
-- -----------------------------------------------------------------------------

-- Usuário já logado cria uma empresa adicional (vira admin dela).
create or replace function public.create_company(p_name text, p_cnpj text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  insert into companies (name, cnpj, created_by)
  values (trim(p_name), nullif(trim(p_cnpj), ''), auth.uid()) returning id into v_id;
  insert into company_members (company_id, user_id, role) values (v_id, auth.uid(), 'admin');
  return v_id;
end;
$$;

-- Dados públicos mínimos de um convite (para a tela de aceite, inclusive sem login).
create or replace function public.get_invitation(p_token uuid)
returns table (company_name text, email text, role text, expired boolean, accepted boolean)
language sql stable security definer set search_path = public as $$
  select c.name, i.email, i.role, i.expires_at <= now(), i.accepted_at is not null
    from invitations i join companies c on c.id = i.company_id
   where i.token = p_token;
$$;

-- Usuário já cadastrado aceita um convite.
create or replace function public.accept_invitation(p_token uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_invite invitations%rowtype; v_email text;
begin
  select email into v_email from profiles where id = auth.uid();
  if v_email is null then raise exception 'Não autenticado'; end if;
  select * into v_invite from invitations where token = p_token;
  if not found then raise exception 'Convite não encontrado'; end if;
  if v_invite.accepted_at is not null then raise exception 'Convite já utilizado'; end if;
  if v_invite.expires_at <= now() then raise exception 'Convite expirado'; end if;
  if lower(v_invite.email) <> lower(v_email) then
    raise exception 'Este convite foi enviado para %', v_invite.email;
  end if;
  insert into company_members (company_id, user_id, role)
  values (v_invite.company_id, auth.uid(), v_invite.role)
  on conflict (company_id, user_id) do update set role = excluded.role;
  update invitations set accepted_at = now() where id = v_invite.id;
  return v_invite.company_id;
end;
$$;

-- Admin altera o papel de um membro (não deixa a empresa sem admin).
create or replace function public.set_member_role(p_company uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.member_role(p_company) <> 'admin' and not public.is_platform_owner() then
    raise exception 'Apenas administradores podem alterar papéis';
  end if;
  if p_role not in ('admin', 'planner', 'viewer') then raise exception 'Papel inválido'; end if;
  if p_role <> 'admin' and (select role from company_members where company_id = p_company and user_id = p_user) = 'admin'
     and (select count(*) from company_members where company_id = p_company and role = 'admin') <= 1 then
    raise exception 'A empresa precisa ter pelo menos um administrador';
  end if;
  update company_members set role = p_role where company_id = p_company and user_id = p_user;
end;
$$;

-- Admin remove um membro (ou o próprio usuário sai), sem deixar a empresa sem admin.
create or replace function public.remove_member(p_company uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user <> auth.uid() and public.member_role(p_company) <> 'admin' and not public.is_platform_owner() then
    raise exception 'Apenas administradores podem remover membros';
  end if;
  if (select role from company_members where company_id = p_company and user_id = p_user) = 'admin'
     and (select count(*) from company_members where company_id = p_company and role = 'admin') <= 1 then
    raise exception 'A empresa precisa ter pelo menos um administrador';
  end if;
  delete from company_members where company_id = p_company and user_id = p_user;
end;
$$;

-- Dono do sistema: libera, bloqueia ou estende o teste de uma empresa.
create or replace function public.owner_set_company_status(
  p_company uuid, p_status text, p_trial_days integer default null, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_owner() then raise exception 'Acesso restrito ao dono do sistema'; end if;
  if p_status not in ('trial', 'active', 'blocked') then raise exception 'Status inválido'; end if;
  update companies
     set status = p_status,
         trial_ends_at = case when p_trial_days is not null then now() + make_interval(days => p_trial_days) else trial_ends_at end,
         notes = coalesce(p_notes, notes)
   where id = p_company;
end;
$$;

-- Dono do sistema: visão geral com contagem de usuários e última atividade.
create or replace function public.owner_company_overview()
returns table (
  id uuid, name text, cnpj text, status text, trial_ends_at timestamptz, notes text,
  created_at timestamptz, member_count bigint, admin_emails text, last_activity timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.cnpj, c.status, c.trial_ends_at, c.notes, c.created_at,
         (select count(*) from company_members m where m.company_id = c.id),
         (select string_agg(p.email, ', ') from company_members m join profiles p on p.id = m.user_id
           where m.company_id = c.id and m.role = 'admin'),
         (select max(pl.updated_at) from plans pl where pl.company_id = c.id)
    from companies c
   where public.is_platform_owner()
   order by c.created_at desc;
$$;

-- updated_at automático nos planos
create or replace function public.touch_plan()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
drop trigger if exists plans_touch on public.plans;
create trigger plans_touch before update on public.plans
  for each row execute function public.touch_plan();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.profiles        enable row level security;
alter table public.companies       enable row level security;
alter table public.company_members enable row level security;
alter table public.invitations     enable row level security;
alter table public.plans           enable row level security;
alter table public.scenarios       enable row level security;

-- profiles: o próprio, colegas de empresa e o dono do sistema enxergam.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (
  id = auth.uid()
  or public.is_platform_owner()
  or exists (
    select 1 from company_members a join company_members b on a.company_id = b.company_id
     where a.user_id = auth.uid() and b.user_id = profiles.id)
);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (id = auth.uid());
-- Só o nome é editável pelo usuário (is_platform_owner nunca).
revoke update on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;

-- companies: membros veem a própria empresa (mesmo bloqueada, para exibir o aviso).
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select
  using (public.is_member(id) or public.is_platform_owner());
drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies for update
  using (public.member_role(id) = 'admin' or public.is_platform_owner());
-- Admin edita só nome e CNPJ; status/teste apenas via owner_set_company_status.
revoke update on public.companies from authenticated, anon;
grant update (name, cnpj) on public.companies to authenticated;

-- company_members: leitura para membros da mesma empresa; escrita só via RPC.
drop policy if exists members_select on public.company_members;
create policy members_select on public.company_members for select
  using (public.is_member(company_id) or public.is_platform_owner());

-- invitations: admins da empresa gerenciam.
drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations for select
  using (public.member_role(company_id) = 'admin' or public.is_platform_owner());
drop policy if exists invitations_insert on public.invitations;
create policy invitations_insert on public.invitations for insert
  with check (public.member_role(company_id) = 'admin' and public.company_is_usable(company_id) and invited_by = auth.uid());
drop policy if exists invitations_delete on public.invitations;
create policy invitations_delete on public.invitations for delete
  using (public.member_role(company_id) = 'admin');

-- plans
drop policy if exists plans_select on public.plans;
create policy plans_select on public.plans for select using (public.can_read(company_id));
drop policy if exists plans_insert on public.plans;
create policy plans_insert on public.plans for insert with check (public.can_edit(company_id));
drop policy if exists plans_update on public.plans;
create policy plans_update on public.plans for update
  using (public.can_edit(company_id)) with check (public.can_edit(company_id));
drop policy if exists plans_delete on public.plans;
create policy plans_delete on public.plans for delete
  using (public.member_role(company_id) = 'admin' and public.company_is_usable(company_id));

-- scenarios
drop policy if exists scenarios_select on public.scenarios;
create policy scenarios_select on public.scenarios for select using (public.can_read(company_id));
drop policy if exists scenarios_insert on public.scenarios;
create policy scenarios_insert on public.scenarios for insert with check (public.can_edit(company_id));
drop policy if exists scenarios_delete on public.scenarios;
create policy scenarios_delete on public.scenarios for delete using (public.can_edit(company_id));

-- Permissões de execução das RPCs
revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.get_invitation(uuid) to anon, authenticated;
grant execute on function public.create_company(text, text),
                          public.accept_invitation(uuid),
                          public.set_member_role(uuid, uuid, text),
                          public.remove_member(uuid, uuid),
                          public.owner_set_company_status(uuid, text, integer, text),
                          public.owner_company_overview()
  to authenticated;

-- -----------------------------------------------------------------------------
-- Depois de criar sua conta no app, torne-se o dono do sistema rodando:
--   update public.profiles set is_platform_owner = true where email = 'seu@email.com';
-- -----------------------------------------------------------------------------
