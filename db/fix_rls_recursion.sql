-- =============================================
-- FIX RLS RECURSION - Run this in Supabase SQL Editor
-- =============================================

-- Step 1: Make is_org_member function use SECURITY DEFINER to bypass RLS
create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql stable security definer as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
  );
$$;

-- Step 2: Fix org_members policies to use direct auth.uid() check
-- This prevents infinite recursion when is_org_member queries org_members
drop policy if exists org_members_select on public.org_members;
create policy org_members_select on public.org_members for select using (user_id = auth.uid());

drop policy if exists org_members_modify on public.org_members;
create policy org_members_modify on public.org_members for insert with check (user_id = auth.uid());

-- Step 3: Also make current_user_role function use SECURITY DEFINER
create or replace function public.current_user_role(p_org_id uuid)
returns public.user_role
language sql stable security definer as $$
  select role
  from public.org_members
  where org_id = p_org_id and user_id = auth.uid()
  limit 1;
$$;

