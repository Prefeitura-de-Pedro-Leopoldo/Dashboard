# Inscrições ao vivo (servirInscricoes.gs)

Lê em tempo real as planilhas de respostas do Google Forms ("Inscrição") que
ficam dentro de cada pasta de evento no Drive e mostra os inscritos no
dashboard (aba **Inscrições** do detalhe do evento).

## Como funciona

```
Google Forms (1 por evento)
  └─ planilha de respostas "Inscrição"  (Google Sheets nativo)
       ↓ fica DENTRO da pasta do evento, junto do participantes.xlsx:
       assets/docs/relatorios/<evento>/[<turma|modulo>/]Inscrição
Apps Script  servirInscricoes.gs   (Web App, lê a planilha viva por ID)
  ↓
Vercel  /api/inscricoes?path=<pasta do evento>
  ↓
Dashboard  aba "Inscrições"
```

- A associação evento ↔ inscrição é **pela pasta**: o dashboard pega o caminho
  do `participantes.xlsx` do evento (`fonte`), remove o nome do arquivo e usa a
  pasta resultante para procurar a planilha "Inscrição" ali dentro.
- O nome pode ter acento ou não, maiúsculas ou não — o detector normaliza
  (basta começar com "inscri"). Ex.: `Inscrição`, `inscricao`,
  `Inscrições (respostas)`.

## Passo a passo

1. **Pasta raiz do Drive**: `ROOT_FOLDER_ID` deve ser a pasta **relatorios**
   (cujos filhos diretos são as pastas dos eventos), e **não** a pasta `assets`.
   ID atual: `1Jfyl8jE70W05t8YydDvVMEzkqXZZ7QJK`.
2. **Token**: em `servirInscricoes.gs`, troque `SHARED_TOKEN` por uma string
   longa e aleatória.
3. **Publicar o Web App**:
   - Cole o conteúdo de `servirInscricoes.gs` num projeto Apps Script standalone.
   - *Implantar → Nova implantação → Tipo: App da Web*.
   - *Executar como*: você. *Quem pode acessar*: **Qualquer pessoa**.
   - Copie a URL `/exec`.
   - Autorize os escopos (Drive + Planilhas) na primeira execução.
4. **Variáveis na Vercel** (e no `.env` local — `vercel dev` lê o `.env`):
   ```
   INSCRICOES_WEBAPP_URL=https://script.google.com/macros/s/XXXX/exec
   INSCRICOES_TOKEN=<o mesmo SHARED_TOKEN do .gs>
   ```
5. **Colocar a planilha "Inscrição"** na pasta do evento, no Drive, junto do
   `participantes.xlsx`. Pode ser a própria planilha de respostas vinculada ao
   Forms (mova-a para a pasta do evento).

## Testes rápidos

- Healthcheck/listagem (debug): abra no navegador
  `…/exec?action=manifest&token=SEU_TOKEN` → deve listar as planilhas
  "Inscrição" encontradas, com o caminho da pasta.
- Pelo proxy: `/api/inscricoes?manifest=1` (na Vercel) ou
  `/api/inscricoes?path=mapa-gerenciamento-risco-2026-05/turma 1`.

## Endpoints do Apps Script

| Ação | Exemplo | Retorno |
|---|---|---|
| `manifest` | `?action=manifest&token=…` | `{ ok, sheets:[{folder,name,id}] }` |
| `inscritos` (por pasta) | `?action=inscritos&token=…&path=<pasta>` | `{ ok, folder, sheetId, total, inscritos:[{nome,email,dataInscricao}], atualizadoEm }` |
| `inscritos` (por id) | `?action=inscritos&token=…&id=<sheetId>` | idem |

## Observações

- O `/api/inscricoes` tem cache em memória de ~20s; use `?fresh=1` para forçar.
- Eventos **futuros** (com inscrição aberta mas ainda sem `participantes.xlsx`)
  ainda não aparecem no seletor do dashboard — isso será resolvido na fase de
  cadastro de encontros/lembretes.
- O envio automático de lembretes (gatilho diário) é uma fase separada; este
  módulo cobre **apenas a leitura ao vivo das inscrições**.
