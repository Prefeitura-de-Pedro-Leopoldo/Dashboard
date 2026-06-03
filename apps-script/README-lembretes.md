# Lembretes de encontros (lembretesEventos.gs)

Guarda a configuração de encontros de cada turma (datas, horários, lembrete
ativo e **horário do disparo**) e envia um e-mail de lembrete **1 dia antes** de
cada encontro, para os inscritos da planilha "Inscrição" daquela pasta.

## Componentes
```
Dashboard (aba Encontros & Lembretes)
  ↓ salva/carrega
Vercel /api/lembretes  (config-get / config-save)
  ↓
Apps Script lembretesEventos.gs
  ├─ Planilha de armazenamento (abas "Encontros" e "LembretesLog")
  ├─ lê os inscritos da planilha "Inscrição" da pasta (mesma raiz dos relatórios)
  └─ gatilho de hora em hora: envia 1 dia antes de cada encontro, no horário escolhido
```

## Passo a passo
1. **Planilha de armazenamento**: crie uma planilha Google em branco (ex.: "Lembretes EGov"). Copie a ID da URL (`/d/<ID>/edit`) e cole em `STORAGE_SHEET_ID` no `.gs`.
2. **Pasta**: confirme que `ROOT_FOLDER_ID` é a mesma do `servirInscricoes.gs` (`1Jfyl8jE70W05t8YydDvVMEzkqXZZ7QJK`). Já vem preenchido.
3. **Remetente**: ajuste `SENDER_EMAIL`/`REPLY_TO`/`BCC_EMAIL` (pode reusar os do `enviarCertificados.gs`). Deixe `DRY_RUN = true` para testar sem enviar; troque para `false` quando validar.
4. **Publicar Web App**: cole o `lembretesEventos.gs` num projeto Apps Script → Implantar → App da Web → executar como você, acesso "Qualquer pessoa". Autorize Drive/Planilhas/Gmail. Copie a URL `/exec`.
5. **Variáveis** (`.env` local e Vercel):
   ```
   LEMBRETES_WEBAPP_URL=https://script.google.com/macros/s/XXXX/exec
   LEMBRETES_TOKEN=zkZEZ5nMCNQkC9tyiBmeGI4bTwMFKunEFNUsObmnfBEDViuL
   ```
6. **Gatilho**: no editor do Apps Script, rode a função **`instalarGatilhoLembretes`** uma vez (cria o disparo de hora em hora).

## Como funciona o envio
- O gatilho roda toda hora. Para cada turma com lembrete ativo cujo **horário de disparo = hora atual** e que tem um encontro **amanhã** ainda não notificado, ele lê os inscritos e envia o e-mail (um por destinatário).
- O `LembretesLog` evita reenvio do mesmo encontro.
- `DRY_RUN = true` só registra no log (não envia) — use para validar antes.

## Observações
- A `eventoKey` é o caminho da pasta da turma (ex.: `ciclo-de-debates-pl-por-elas-2026-05/turma 3`).
- Limites do Gmail: ~500/dia (consumidor) ou ~1.500-2.000/dia (Workspace).
