-- T2 MinePlanner · 2026-10-20
-- Dono do sistema com acesso livre: edita e apaga planos de qualquer empresa,
-- mesmo em teste vencido ou bloqueada. Rodar uma vez no Neon → SQL Editor.

create or replace function public.can_edit(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_owner()
      or (coalesce(public.member_role(p_company) in ('admin', 'planner'), false)
          and public.company_is_usable(p_company));
$$;

drop policy if exists plans_delete on public.plans;
create policy plans_delete on public.plans for delete
  using (public.is_platform_owner() or (public.member_role(company_id) = 'admin' and public.company_is_usable(company_id)));
