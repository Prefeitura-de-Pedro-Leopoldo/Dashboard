-- 003_initial_passwords.sql
-- Senha temporária + troca obrigatória no primeiro acesso por e-mail/senha.
--
-- `must_change_password = true`: no login por senha o usuário é levado a
-- definir uma nova senha antes de entrar. O login social (Google) ignora a
-- flag (não exige senha).
--
-- O hash abaixo é scrypt da senha temporária "egov2026" (formato
-- scrypt$salt$dk; conferido por lib/users.mjs verifyPassword). Só preenche
-- quem ainda NÃO tem senha própria (password_hash IS NULL), então rodar de
-- novo NÃO sobrescreve quem já trocou.

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

UPDATE app_users
   SET password_hash = 'scrypt$b0a3336c65791608954d1c185846f695$7253936fd89731b6252b2aaa928461f5d8e5161bdde2a7799cfa72d81fd35abbfd33e6d09aaf39985de344d5bf80c1cdb788b1ad7ff779eda8007b96608fc2a1',
       must_change_password = true,
       updated_at = now()
 WHERE password_hash IS NULL;
