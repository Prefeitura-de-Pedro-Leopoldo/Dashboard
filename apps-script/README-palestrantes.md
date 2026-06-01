# Cadastro de Palestrantes (Google Apps Script)

Backend gratuito do módulo **Palestrantes** do painel EGov-PL. A pessoa cadastra
pelo site; **os dados ficam numa Planilha Google e as fotos numa pasta do Drive**.

```
[Form no painel] → /api/palestrantes (proxy Vercel) → Web App Apps Script
                                                        ├─ Planilha (aba "Palestrantes") = banco
                                                        └─ Pasta do Drive = fotos
```

É independente do `enviarCertificados.gs`: tem **token, planilha e pasta
próprios**. Nunca compartilha credenciais com o módulo de certificados.

## Estrutura

- `cadastroPalestrantes.gs` — código para colar no editor Apps Script.
- `README-palestrantes.md` — este arquivo.

## Instalação passo a passo

### 1. Pasta de fotos no Drive
1. Crie uma pasta no Google Drive (ex.: `Fotos Palestrantes`).
2. Abra a pasta e copie o `FOLDER_ID` da URL:
   `https://drive.google.com/drive/folders/`**`<FOLDER_ID>`**.

### 2. Planilha (o "banco")
1. Crie uma **planilha Google Sheets** nova (ex.: `Palestrantes - EGov-PL`).
2. Não precisa criar a aba à mão: o script cria a aba `Palestrantes` com o
   cabeçalho correto na primeira execução.

### 3. Apps Script
1. **Na planilha**, abra **Extensões → Apps Script** (o script precisa ficar
   *vinculado* a essa planilha — é dela que ele lê/escreve).
2. Apague o `Code.gs` padrão e cole o conteúdo de `cadastroPalestrantes.gs`.
3. Edite as constantes no topo:
   - `PHOTOS_FOLDER_ID` → ID da pasta do passo 1.
   - `SHARED_TOKEN` → uma string longa e aleatória (gere em
     <https://www.random.org/strings/>). **Guarde este valor**, será usado na
     Vercel no passo 6.
4. Salve (Ctrl+S).

### 4. Publique a Web App
1. No editor, clique **Implantar → Nova implantação**.
2. Tipo: **Aplicativo da Web**.
3. Descrição: `Cadastro de palestrantes`.
4. Executar como: **Eu**.
5. Quem tem acesso: **Qualquer pessoa** (necessário para o proxy chamar sem
   login do Google; quem protege é o `SHARED_TOKEN`).
6. **Implantar** e autorize as permissões (Sheets + Drive).
7. Copie a **URL do aplicativo da Web** (termina em `/exec`).

> Para confirmar que está no ar, abra a URL no navegador. Deve responder
> `{"ok":true,"service":"cadastroPalestrantes"}`.

### 5. (Opcional) Teste rápido via curl
```bash
curl -L -X POST "<URL_/exec>" \
  -H "Content-Type: application/json" \
  -d '{"token":"<SEU_TOKEN>","action":"list"}'
# Esperado: {"ok":true,"palestrantes":[]}
```

### 6. Configure na Vercel
No projeto da Vercel (ou em `.env.local` para rodar local), defina:

| Variável | Valor |
|----------|-------|
| `PALESTRANTES_WEBAPP_URL` | a URL `/exec` do passo 4 |
| `PALESTRANTES_TOKEN`      | o mesmo `SHARED_TOKEN` do passo 3 |

O proxy `api/palestrantes.js` injeta o token a partir dessa env var, então
**o token nunca aparece no navegador**.

### Atualizando o script
Ao mudar o `.gs`: **Implantar → Gerenciar implantações → editar (lápis) →
Nova versão → Implantar**. A URL **não muda**.

## Contrato da API

Todas as ações são `POST` com JSON. O proxy adiciona o `token` automaticamente.

**Ações de administração** (chamadas pelo painel logado):

| Ação | Corpo | Resposta |
|------|-------|----------|
| `create` | `{action:"create", nome, eixos:[...], cursoId, cursoTitulo, miniBio, fotoBase64?, fotoMime?}` | `{ok, palestrante}` |
| `list`   | `{action:"list"}` | `{ok, palestrantes:[...]}` |
| `update` | `{action:"update", id, ...campos, fotoBase64?, removerFoto?}` | `{ok, palestrante}` |
| `delete` | `{action:"delete", id}` | `{ok, id}` |
| `invite-create` | `{action:"invite-create"}` | `{ok, token}` |
| `invite-list`   | `{action:"invite-list"}` | `{ok, convites:[...]}` |
| `invite-revoke` | `{action:"invite-revoke", convite}` | `{ok, token}` |

**Ações públicas** (a página `cadastro-palestrante.html` chama via `?convite=<token>`):

| Ação | Corpo | Resposta |
|------|-------|----------|
| `invite-check`  | `{action:"invite-check", convite}` | `{ok, valid, reason?}` |
| `invite-submit` | `{action:"invite-submit", convite, nome, eixos:[...], cursoTitulo, miniBio, fotoBase64, fotoMime}` | `{ok}` |

`eixos` pode ser um array (`["Saúde","Educação"]`) ou string `"A; B"`; é gravado
como texto separado por `; ` e devolvido como array no `list`. `fotoBase64` pode
ser uma *data URL* completa ou só o base64.

## Formulário público (link de convite de uso único)

1. No painel: **Palestrantes → Galeria → "Gerar link de convite"**. Isso cria um
   token (`invite-create`) e mostra a URL pronta:
   `https://SEU-SITE/cadastro-palestrante?convite=<token>`.
2. Envie esse link ao palestrante. Ele abre **sem login**, preenche os campos
   (Nome, Eixos múltiplos, Curso livre, Mini bio, Foto — todos obrigatórios) e
   envia (`invite-submit`).
3. No envio, o convite é **queimado** (`Status = usado` na aba `Convites`) e não
   pode ser reutilizado. Para um novo cadastro, gere outro link.
4. Para invalidar um link antes do uso, use `invite-revoke` (ou edite o `Status`
   do convite para `revogado` na planilha).

## Colunas

**Aba `Palestrantes`:**

| ID | Nome | Eixos | CursoId | CursoTitulo | MiniBio | FotoFileId | CriadoEm | AtualizadoEm | Status | Origem |
|----|------|-------|---------|-------------|---------|------------|----------|--------------|--------|--------|

`Origem` = `admin` (cadastrado no painel) ou `convite` (auto-cadastro via link).

**Aba `Convites`:**

| Token | Status | CriadoEm | UsadoEm | PalestranteId |
|-------|--------|----------|---------|---------------|

`Status` = `pendente` → `usado` (após envio) ou `revogado`.

## Notas de segurança e operação

- **Token**: requisições sem o `SHARED_TOKEN` correto são rejeitadas.
- **Exclusão é lógica**: `delete` marca `Status = inativo` (preserva histórico)
  e descarta a foto do Drive. Para reativar, edite a célula `Status` para
  `ativo` na planilha.
- **Fotos**: ficam com permissão "qualquer um com link → leitor" para a
  thumbnail carregar no painel. Não há listagem pública da pasta.
- **Convites**: o token é um UUID (impossível de adivinhar) e de **uso único**.
  Mesmo sendo um endpoint público, sem um token válido e pendente o
  `invite-submit` é rejeitado.
- **Cota**: cada execução do Apps Script tem 6 min — irrelevante para o volume
  de palestrantes (dezenas).
