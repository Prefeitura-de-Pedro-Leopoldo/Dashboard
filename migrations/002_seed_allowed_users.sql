-- 002_seed_allowed_users.sql
-- Usuários autorizados a acessar o painel (allowlist inicial).
-- Idempotente: rodar de novo não duplica nem sobrescreve.
-- Sem senha (password_hash NULL): entram pelo Google. Para liberar login por
-- senha, defina o hash depois (scrypt) ou mantenha a senha legada no .env.

INSERT INTO app_users (email, name) VALUES
  ('lucelho.silva@pedroleopoldo.mg.gov.br',   'Lucelho Silva'),
  ('makerly.toledo@pedroleopoldo.mg.gov.br',  'Makerly Aparecida Maia Toledo'),
  ('gabriel.albino@pedroleopoldo.mg.gov.br',  'Gabriel Albino Ponciano Nepomuceno'),
  ('thiago.avila@pedroleopoldo.mg.gov.br',    'Thiago Jose Tavares Ávila'),
  ('auricelio.souza@pedroleopoldo.mg.gov.br', 'Auricelio Alves de Souza Sobrinho'),
  ('fabiana.silva@pedroleopoldo.mg.gov.br',   'Fabiana Cristina da Silva'),
  ('andrea.rocha@pedroleopoldo.mg.gov.br',    'Andrea Mara da Cruz Rocha')
ON CONFLICT (lower(email)) DO NOTHING;
