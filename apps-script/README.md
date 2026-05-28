# Disparo automatico de certificados (Google Apps Script)

Modulo gratuito que envia certificados em PDF individualmente a partir de uma
planilha Google Sheets, lendo arquivos de uma pasta do Google Drive e enviando
por Gmail. Cada destinatario recebe **somente o seu PDF** - nunca CC/BCC, nunca
multiplos anexos por mensagem.

Este modulo e independente do app web do projeto (Vercel/Node); roda 100% no
Google Apps Script.

## Estrutura

- `enviarCertificados.gs` - codigo para colar no editor Apps Script.
- `README.md` - este arquivo.

## Instalacao passo a passo

### 1. Pasta no Drive
1. Crie uma pasta no Google Drive (ex.: `Certificados - Evento X`).
2. Suba todos os PDFs nessa pasta.
3. Abra a pasta e copie o `FOLDER_ID` da URL:
   `https://drive.google.com/drive/folders/`**`<FOLDER_ID>`**.

### 2. Planilha
1. Crie uma planilha Google Sheets.
2. Renomeie/crie a aba `Certificados`.
3. Na linha 1, adicione exatamente estas colunas (A..F):

   | Nome | Email | Arquivo PDF | Status | Log | Enviado em |
   |------|-------|-------------|--------|-----|------------|

4. Preencha as linhas. `Arquivo PDF` deve ser o **nome exato** do arquivo no
   Drive (incluindo `.pdf`). Deixe `Status`, `Log` e `Enviado em` vazios.

> **Atalho:** o `gerador-certificado.html` deste projeto ja produz essa
> planilha automaticamente. Ao gerar PDFs em massa, o ZIP baixado contem
> `planilha-envio.csv` com `Nome,Email,Arquivo PDF` ja preenchidos e os
> nomes de arquivo identicos aos PDFs. Importe via **Arquivo -> Importar ->
> Upload** no Google Sheets, escolhendo "Substituir planilha" e separador
> "Detectar automaticamente". Renomeie a aba para `Certificados`.

### 3. Apps Script
1. Na planilha, abra **Extensoes -> Apps Script**.
2. Apague o `Code.gs` padrao e cole o conteudo de `enviarCertificados.gs`.
3. Edite as constantes no topo:
   - `FOLDER_ID` - ID da pasta do passo 1.
   - `TEST_EMAIL` - seu e-mail interno (para teste).
   - `PROJECT_NAME` - nome que aparece como remetente.
   - `MAX_SENDS_PER_RUN` - limite por execucao (padrao 50).
   - `DRY_RUN` - comece com `true`.
4. Salve (Ctrl+S).

### 4. Teste e autorizacao
1. Selecione a funcao `enviarCertificadoTeste` na barra superior e clique
   **Executar**. Autorize as permissoes solicitadas (Gmail, Drive, Sheets).
2. Confirme que o e-mail chegou no `TEST_EMAIL` com o PDF correto.

### 5. Simulacao com a planilha real
1. Mantenha `DRY_RUN = true`.
2. Execute `enviarCertificados`.
3. Verifique a coluna `Log` - cada linha mostrara `DRY_RUN: enviaria para ...`.
4. Corrija eventuais erros de validacao (e-mail invalido, PDF nao encontrado etc.).

### 6. Envio real
1. Mude `DRY_RUN = false`.
2. Execute `enviarCertificados`.
3. As linhas processadas com sucesso ficam com `Status = ENVIADO` e nao serao
   reenviadas em execucoes futuras.

## Modo automatico (1 clique no admin web)

O `gerador-certificado.html` pode disparar todo o fluxo (gerar PDF, salvar no
Drive, registrar na planilha e enviar e-mail) sem voce abrir a planilha.
Para isso, publique este script como **Web App**:

### 1. Defina um token forte
No topo do `enviarCertificados.gs`, troque `SHARED_TOKEN` por uma string longa
e aleatoria (ex.: gere em https://www.random.org/strings/). Esse token e o
unico segredo entre o admin web e o Apps Script.

### 2. Publique a Web App
1. No editor do Apps Script, clique em **Implantar -> Nova implantacao**.
2. Tipo: **Aplicativo da Web**.
3. Descricao: `Endpoint de envio de certificados`.
4. Executar como: **Eu (`lucelho.silva@pedroleopoldo.mg.gov.br`)**.
5. Quem tem acesso: **Qualquer pessoa** (necessario para o navegador chamar
   sem login; o token e quem protege).
6. Clique **Implantar** e autorize as permissoes solicitadas.
7. Copie a **URL do aplicativo da Web** (termina em `/exec`).

> Para confirmar que esta no ar: abra a URL no navegador. Deve responder
> `{"ok":true,"service":"enviarCertificados"}`.

### 3. Configure no admin web
1. Abra `gerador-certificado.html`.
2. No bloco "Geracao em massa", expanda **Envio automatico por e-mail**.
3. Cole a **URL da Web App** e o **mesmo token** do passo 1.
4. (Os campos ficam salvos no `localStorage` do navegador.)

### 4. Use
1. Suba o CSV com `nome,email,curso,...`.
2. Clique em **Gerar e Enviar por e-mail**.
3. Cada linha vira: PDF gerado no navegador -> POST para a Web App -> Drive +
   planilha + Gmail. Barra de progresso mostra `X/N enviados`.

### Atualizando o script
Cada vez que voce mudar o `.gs`, precisa fazer **Implantar -> Gerenciar
implantacoes -> editar (lapis) -> Nova versao -> Implantar**. A URL nao muda.

### DRY_RUN tambem vale no modo Web App
Se `DRY_RUN = true`, o endpoint salva o PDF no Drive e registra na planilha
com status `DRY_RUN`, mas **nao envia o e-mail**. Util para testar a
integracao ponta a ponta sem soltar mensagens reais.

---

## DRY_RUN

Quando `DRY_RUN = true`:
- Nenhum e-mail e enviado.
- A coluna `Status` recebe `DRY_RUN`.
- A coluna `Log` descreve o que seria enviado.
- A coluna `Enviado em` recebe o timestamp da simulacao.

Use sempre antes de um disparo real, especialmente em lotes grandes.

## Como evitar reenvio

- Linhas com `Status = ENVIADO` sao ignoradas automaticamente.
- Apos um disparo real bem sucedido, **nao limpe** a coluna `Status`.
- Para reenviar uma linha especifica de proposito, apague o conteudo de
  `Status` daquela linha.
- O `MAX_SENDS_PER_RUN` evita que uma execucao acidental dispare a lista
  inteira de uma vez.

## Validacoes e seguranca

- E-mail vazio ou em formato invalido -> erro registrado, sem envio.
- Nome ou nome do arquivo vazios -> erro, sem envio.
- Arquivo nao encontrado na pasta -> erro, sem envio.
- Mais de um arquivo com o mesmo nome -> erro, sem envio (ambiguidade).
- Arquivo com mime diferente de `application/pdf` -> erro, sem envio.
- Linhas ja `ENVIADO` nunca sao reprocessadas.
- Nenhum link publico e gerado; o PDF vai como anexo binario.
- As permissoes dos arquivos no Drive nao sao alteradas.

## Limites gratuitos do Gmail (Apps Script)

- Conta Google gratuita (`@gmail.com`): **500 e-mails/dia**.
- Google Workspace: **1.500 e-mails/dia**.
- Cada execucao do Apps Script tem **6 minutos** de tempo maximo.
- Para listas grandes, ajuste `MAX_SENDS_PER_RUN` (ex.: 100) e rode varias
  vezes ao longo do dia, ou configure um gatilho de tempo (Triggers) para
  rodar `enviarCertificados` a cada hora - como linhas `ENVIADO` sao puladas,
  e seguro.
- Cota restante pode ser consultada via `MailApp.getRemainingDailyQuota()`.

## Producao

A versao em `enviarCertificados.gs` ja e a versao final pronta para producao.
Antes do primeiro disparo real, confirme:

- [ ] `FOLDER_ID` configurado.
- [ ] `TEST_EMAIL` testado com sucesso.
- [ ] `PROJECT_NAME` ajustado.
- [ ] `DRY_RUN` executado e logs revisados.
- [ ] `MAX_SENDS_PER_RUN` compativel com o tamanho do lote e cota do Gmail.
- [ ] `DRY_RUN = false` apenas no momento do disparo.
