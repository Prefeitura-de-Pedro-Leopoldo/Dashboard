# Dashboard

## Como adicionar uma nova planilha de evento

1. Coloque o `.xlsx` em `assets/docs/relatorios/` com o prefixo padrão **`Lista de participantes - <slug>.xlsx`**.
   A planilha deve ter as colunas (Sympla padrão): `Nome, Email, Secretaria, Cargo/Função, Matrícula, Turma, Check-in, Data de Inscrição, Data de Check-in`.
2. Adicione uma entrada em `assets/docs/relatorios/eventos-meta.json` com `id`, `title`, `date`, `local`, `vagas`, etc. (Se omitir, o build usa defaults derivados do nome do arquivo.)
3. Rode `npm run build` (ou faça `git push` - o Vercel roda o build automaticamente).
   Isso regenera **`eventos-data.json`** (raiz) e **`assets/docs/relatorios/manifest.json`**, que alimentam o dashboard e o gerador de certificados.

Se o cabeçalho não bater com o esperado, o build falha com mensagem clara - nada quebrado vai pro deploy.

## Comandos

```bash
npm install        # primeira vez
npm run build      # gera eventos-data.json + manifest.json a partir das .xlsx
```
