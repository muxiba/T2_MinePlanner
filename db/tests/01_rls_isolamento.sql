\set ON_ERROR_STOP 1
-- Usuários criados pelo Neon Auth
insert into neon_auth."user"(id, name, email) values
 ('00000000-0000-0000-0000-00000000000a','Ana','ana@alfa.com'),
 ('00000000-0000-0000-0000-00000000000b','Bia','Bia@Beta.com'),
 ('00000000-0000-0000-0000-00000000000c','Caio','caio@alfa.com'),
 ('00000000-0000-0000-0000-0000000000f0','Dono','dono@t2.com');

create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false) $$;
set role authenticated;

-- Ana cadastra a Alfa; Bia a Beta; Dono só cria perfil
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select sync_profile('Ana Souza'); select create_company('Alfa Mineração', '11.111.111/0001-11');
insert into plans(company_id, name, premises, routes) select id,'P1','{}','[]' from companies;
insert into invitations(company_id, email, role) select id, 'caio@alfa.com', 'viewer' from companies;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select sync_profile(null); select create_company('Beta Ltda');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f0'); select sync_profile(null);
reset role; update profiles set is_platform_owner = true where email = 'dono@t2.com'; set role authenticated;


-- Caio entra pelo convite
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
reset role;
select set_config('t.tok', (select token::text from invitations), false);
set role anonymous;
select 'anon vê convite' t, company_name, email, role from get_invitation(current_setting('t.tok')::uuid);
do $$ begin
  begin perform count(*) from plans; raise exception 'FALHA: anônimo leu planos';
  exception when insufficient_privilege then raise notice 'OK: anônimo não lê tabelas'; end;
end $$;
set role authenticated;
select sync_profile('Caio'); select accept_invitation(current_setting('t.tok')::uuid) is not null as caio_aceitou;

-- Bia não vê nada da Alfa
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select 'Bia vê empresas' t, string_agg(name, ',') from companies;
select 'Bia vê planos Alfa' t, count(*) from plans;
select 'Bia vê perfis' t, string_agg(email, ',') from profiles;
do $$ begin
  update plans set name='hack'; if found then raise exception 'FALHA: Bia alterou plano da Alfa'; end if;
  begin update profiles set is_platform_owner = true; raise exception 'FALHA: escalou privilégio';
  exception when insufficient_privilege then raise notice 'OK: não consegue virar dona'; end;
  begin update companies set status = 'active'; raise exception 'FALHA: mudou status';
  exception when insufficient_privilege then raise notice 'OK: não muda status'; end;
  begin insert into company_members values ((select id from companies limit 1), auth.user_id(), 'admin'); raise exception 'FALHA: entrou em empresa';
  exception when insufficient_privilege then raise notice 'OK: não se adiciona em empresa'; end;
end $$;

-- Caio (leitor) lê mas não edita
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select 'Caio vê planos' t, count(*) from plans;
do $$ begin
  update plans set name='x'; if found then raise exception 'FALHA: leitor editou'; end if;
  begin insert into scenarios(company_id,name,premises,routes) select company_id,'s','{}','[]' from plans;
        raise exception 'FALHA: leitor criou cenário';
  exception when insufficient_privilege then raise notice 'OK: leitor não cria cenário'; end;
  begin perform remove_member((select company_id from plans limit 1), '00000000-0000-0000-0000-00000000000a');
        raise exception 'FALHA: leitor removeu admin';
  exception when raise_exception then if sqlerrm like 'FALHA%' then raise; end if; raise notice 'OK: %', sqlerrm; end;
end $$;

-- Ana: não fica sem admin; promove Caio; edita plano e cria cenário
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ declare c uuid := (select id from companies); begin
  begin perform set_member_role(c, auth.user_id(), 'viewer'); raise exception 'FALHA: ficou sem admin';
  exception when raise_exception then if sqlerrm like 'FALHA%' then raise; end if; raise notice 'OK: %', sqlerrm; end;
  perform set_member_role(c, '00000000-0000-0000-0000-00000000000c', 'planner');
end $$;
select 'Ana vê membros' t, string_agg(m.role||':'||p.email||' ('||coalesce(p.full_name,'')||')', ', ') from company_members m join profiles p on p.id=m.user_id;
update plans set name='P1 editado' returning 'Ana editou' t, name, updated_by is not null as tem_autor;
update companies set name = 'Alfa Mineração S.A.' returning 'Ana renomeou' t, name;
insert into scenarios(company_id, plan_id, name, premises, routes) select company_id, id, 'Cen A', '{}', '[]' from plans returning 'cenário' t, created_by is not null as tem_autor;

-- Dono bloqueia a Alfa -> Ana perde acesso
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f0');
select 'Dono overview' t, name, status, member_count, admin_emails from owner_company_overview();
select owner_set_company_status((select id from companies where name like 'Alfa%'), 'blocked');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select 'Ana bloqueada vê planos' t, count(*) from plans;
select 'Ana bloqueada vê empresa' t, name, status from companies;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select 'Bia overview' t, count(*) from owner_company_overview();
-- Teste expirado bloqueia escrita
reset role; update companies set trial_ends_at = now() - interval '1 day' where name like 'Beta%'; set role authenticated;
do $$ begin
  begin insert into plans(company_id) select id from companies; raise exception 'FALHA: criou plano com teste expirado';
  exception when insufficient_privilege then raise notice 'OK: teste expirado bloqueia escrita'; end;
end $$;
select 'FIM: todos os testes passaram' t;
