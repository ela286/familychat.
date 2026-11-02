
-- =========================================
-- FAMILYCHAT - BASE DE DATOS COMPLETA
-- Clave inicial de invitación: amoalilli
-- =========================================

-- 1. Extensión para generar hashes
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Asegurar que pgcrypto esté en el esquema esperado
alter extension pgcrypto set schema extensions;

-- 2. Perfiles de usuarios
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  invite_accepted boolean not null default false,
  created_at timestamptz not null default now()
);

-- 3. Crear perfil automáticamente al registrarse
create or replace function public.create_familychat_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    display_name,
    avatar_url
  )
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      'Usuario'
    ),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_familychat on auth.users;

create trigger on_auth_user_created_familychat
after insert on auth.users
for each row
execute function public.create_familychat_profile();

-- 4. Códigos de invitación
create table if not exists public.invite_codes (
  id bigint generated always as identity primary key,
  code_hash text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.invite_codes (code_hash)
values (
  encode(extensions.digest('amoalilli', 'sha256'), 'hex')
)
on conflict (code_hash) do nothing;

-- 5. Validar invitaciones
create or replace function public.redeem_invite(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  ok boolean;
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión primero';
  end if;

  select exists (
    select 1
    from public.invite_codes
    where active
      and code_hash = encode(
        extensions.digest(trim(p_code), 'sha256'),
        'hex'
      )
  )
  into ok;

  if not ok then
    raise exception 'Clave de invitación incorrecta';
  end if;

  update public.profiles
  set invite_accepted = true
  where id = auth.uid();

  return true;
end;
$$;

revoke all on function public.redeem_invite(text) from public;
grant execute on function public.redeem_invite(text) to authenticated;

-- 6. Conversaciones
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  is_group boolean not null default true,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 7. Miembros de conversaciones
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- 8. Mensajes
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

-- 9. Función segura para comprobar pertenencia a un chat
create or replace function public.is_conversation_member(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_members
    where conversation_id = p_conversation_id
      and user_id = auth.uid()
  );
$$;

revoke all on function public.is_conversation_member(uuid) from public;
grant execute on function public.is_conversation_member(uuid) to authenticated;

-- 10. Activar seguridad RLS
alter table public.profiles enable row level security;
alter table public.invite_codes enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

-- 11. Políticas de perfiles
drop policy if exists "profile read self" on public.profiles;
create policy "profile read self"
on public.profiles
for select to authenticated
using (id = auth.uid());

drop policy if exists "profile update self" on public.profiles;
create policy "profile update self"
on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- 12. Políticas de conversaciones
drop policy if exists "members can read conversations" on public.conversations;
create policy "members can read conversations"
on public.conversations
for select to authenticated
using (public.is_conversation_member(id));

drop policy if exists "accepted users create conversations" on public.conversations;
create policy "accepted users create conversations"
on public.conversations
for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and invite_accepted = true
  )
);

-- 13. Políticas de miembros
drop policy if exists "members can read memberships" on public.conversation_members;
create policy "members can read memberships"
on public.conversation_members
for select to authenticated
using (public.is_conversation_member(conversation_id));

drop policy if exists "accepted users add themselves" on public.conversation_members;
create policy "accepted users add themselves"
on public.conversation_members
for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and invite_accepted = true
  )
  and exists (
    select 1
    from public.conversations
    where id = conversation_id
      and created_by = auth.uid()
  )
);

-- 14. Políticas de mensajes
drop policy if exists "members read messages" on public.messages;
create policy "members read messages"
on public.messages
for select to authenticated
using (public.is_conversation_member(conversation_id));

drop policy if exists "members send messages" on public.messages;
create policy "members send messages"
on public.messages
for insert to authenticated
with check (
  sender_id = auth.uid()
  and public.is_conversation_member(conversation_id)
);

-- 15. Permisos de acceso
grant select, update on public.profiles to authenticated;
grant select, insert on public.conversations to authenticated;
grant select, insert on public.conversation_members to authenticated;
grant select, insert on public.messages to authenticated;

-- 16. Ocultar códigos de invitación
revoke all on public.invite_codes from anon, authenticated;

-- 17. Activar actualización en tiempo real de mensajes
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
  when undefined_object then
    raise notice 'No se encontró supabase_realtime. Revisa la publicación de Realtime.';
end;
$$;

-- =========================================
-- FIN DE LA CONFIGURACIÓN DE FAMILYCHAT
-- =========================================
