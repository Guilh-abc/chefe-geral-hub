-- Banco D1 da ponte na nuvem (plano grátis). Criado também sozinho pelo Worker na primeira chamada.
CREATE TABLE IF NOT EXISTS itens (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, tipo TEXT NOT NULL,
  criado_em TEXT NOT NULL, titulo TEXT, texto TEXT, meta TEXT);
CREATE INDEX IF NOT EXISTS itens_tipo ON itens(tipo, seq);
CREATE TABLE IF NOT EXISTS updates (update_id INTEGER PRIMARY KEY, em TEXT);
CREATE TABLE IF NOT EXISTS indice (arquivo TEXT PRIMARY KEY, titulo TEXT, tags TEXT);
