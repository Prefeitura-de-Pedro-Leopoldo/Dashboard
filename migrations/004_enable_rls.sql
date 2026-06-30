-- 004_enable_rls.sql
-- Segurança no Supabase: a tabela app_users guarda hash de senha e, em projeto
-- Supabase, qualquer tabela em `public` SEM RLS fica acessível pela API pública
-- (PostgREST + chave publishable/anon). Ativando RLS sem nenhuma policy, os
-- papéis anon/authenticated não conseguem ler nada.
--
-- A aplicação conecta como o papel dono (postgres), que IGNORA RLS, então o
-- login (SELECT/UPDATE em app_users) continua funcionando normalmente.
-- Idempotente: habilitar RLS já habilitado é no-op.

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
