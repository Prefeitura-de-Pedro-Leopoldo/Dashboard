-- 005_palestrante_event.sql
-- Vincula um usuário ao evento/curso que ele pode visualizar. Usado pelo papel
-- 'palestrante': ele só enxerga os inscritos do evento em `evento_id`. Admins
-- ficam com NULL (veem tudo). Idempotente.

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS evento_id TEXT;
