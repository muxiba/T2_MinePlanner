\set ON_ERROR_STOP 1
-- Cadastros (como o Supabase Auth faria)
insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','ana@alfa.com','{"full_name":"Ana","company_name":"Alfa Mineração","company_cnpj":"11"}'),
 ('00000000-0000-0000-0000-00000000000b','bia@beta.com','{"full_name":"Bia","company_name":"Beta Ltda"}'),
 ('00000000-0000-0000-0000-0000000000f0','dono@t2.com','{"full_name":"Dono"}');
update profiles set is_platform_owner = true where email='dono@t2.com';
select 'empresas criadas' t, count(*) from companies;

create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false) $$;

-- ===== Ana (admin Alfa)
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into plans(company_id, name, premises, routes) select id,'P1','{}','[]' from companies;  -- só deve inserir na Alfa
select 'Ana vê empresas' t, string_agg(name, ',') from companies;
select 'Ana vê planos' t, count(*) from plans;
insert into invitations(company_id,email,role,invited_by) select id,'caio@alfa.com','viewer',auth.uid() from companies;
reset role;
-- Caio se cadastra pelo convite
insert into auth.users(id,email,raw_user_meta_data) select '00000000-0000-0000-0000-00000000000c','caio@alfa.com', jsonb_build_object('invite_token', token) from invitations;
select 'Caio membro' t, role from company_members where user_id='00000000-0000-0000-0000-00000000000c';

-- ===== Bia (Beta) não vê nada da Alfa
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select 'Bia vê empresas' t, string_agg(name, ',') from companies;
select 'Bia vê planos Alfa' t, count(*) from plans;
select 'Bia vê perfis' t, string_agg(email, ',') from profiles;
do $$ begin
  update plans set name='hack'; if found then raise exception 'FALHA: Bia alterou plano da Alfa'; end if;
end $$;
do $$ begin
  begin update profiles set is_platform_owner = true where id = auth.uid(); raise exception 'FALHA: escalou privilégio';
  exception when insufficient_privilege then raise notice 'OK: Bia não consegue virar dona'; end;
  begin update companies set status='active'; raise exception 'FALHA: mudou status';
  exception when insufficient_privilege then raise notice 'OK: Bia não muda status'; end;
end $$;

-- ===== Caio (viewer) lê mas não edita
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select 'Caio vê planos' t, count(*) from plans;
do $$ begin
  update plans set name='x'; if found then raise exception 'FALHA: viewer editou'; end if;
  begin insert into scenarios(company_id,name,premises,routes) select company_id,'s','{}','[]' from plans;
        raise exception 'FALHA: viewer criou cenário';
  exception when insufficient_privilege then raise notice 'OK: viewer não cria cenário'; end;
  begin perform remove_member((select company_id from plans limit 1), '00000000-0000-0000-0000-00000000000a');
        raise exception 'FALHA: viewer removeu admin';
  exception when raise_exception then if sqlerrm like 'FALHA%' then raise; end if; raise notice 'OK: %', sqlerrm; end;
end $$;

-- ===== Ana: não pode se rebaixar sendo a única admin; promove Caio a planner
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ declare c uuid := (select id from companies); begin
  begin perform set_member_role(c, auth.uid(), 'viewer'); raise exception 'FALHA: ficou sem admin';
  exception when raise_exception then if sqlerrm like 'FALHA%' then raise; end if; raise notice 'OK: %', sqlerrm; end;
  perform set_member_role(c, '00000000-0000-0000-0000-00000000000c', 'planner');
end $$;
select 'Ana vê membros' t, string_agg(m.role||':'||p.email, ', ') from company_members m join profiles p on p.id=m.user_id;
update plans set name='P1 editado' returning 'Ana editou' t, name, updated_by is not null as tem_autor;

-- ===== Dono bloqueia a Alfa -> Ana perde acesso aos planos
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f0');
select 'Dono overview' t, name, status, member_count, admin_emails from owner_company_overview();
select owner_set_company_status((select id from companies where name like 'Alfa%'), 'blocked');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select 'Ana bloqueada vê planos' t, count(*) from plans;
select 'Ana bloqueada vê empresa' t, name, status from companies;
-- Bia não acessa painel do dono
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select 'Bia overview' t, count(*) from owner_company_overview();
-- Teste expirado
reset role; update companies set trial_ends_at = now() - interval '1 day' where name like 'Beta%';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  begin insert into plans(company_id) select id from companies; raise exception 'FALHA: criou plano com teste expirado';
  exception when insufficient_privilege then raise notice 'OK: teste expirado bloqueia escrita'; end;
end $$;
-- convite público
set role anon;
select 'anon get_invitation' t, * from get_invitation((select token from invitations limit 1));
