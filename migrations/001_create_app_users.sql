-- 001_create_app_users.sql
-- Allowlist de usuários do painel. Só e-mails ATIVOS aqui conseguem logar
-- (por senha em /api/login ou pelo Google em /api/auth/google).

CREATE TABLE IF NOT EXISTS app_users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT        NOT NULL,
  name          TEXT        NOT NULL,
  password_hash TEXT,                 -- scrypt; NULL = usuário só por Google
  role          TEXT        NOT NULL DEFAULT 'admin',
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- E-mail único sem diferenciar maiúsculas/minúsculas.
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_lower_idx
  ON app_users (lower(email));
