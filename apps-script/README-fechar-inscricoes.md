# Fechar inscrições lotadas (Google Apps Script)

Fecha automaticamente o **formulário de inscrição** assim que ele atinge as
**vagas daquele evento**. O Google Forms não tem "encerrar após N respostas"
nativo — este script faz esse controle. Ao fechar, **avisa a Fabiana por
e-mail** (padrão institucional) e o painel mostra uma **notificação** de
"inscrições lotadas".

As vagas **não são um número fixo**: cada formulário usa a capacidade do
respectivo evento, lida da **mesma fonte que o painel** — o campo `vagas` do
`assets/docs/relatorios/eventos-meta.json`. Usa o `eventos-meta.json` (e não o
`eventos-data.json`) de propósito: assim eventos **futuros** — que ainda não têm
`participantes.xlsx`, mas já estão com inscrição aberta — também têm as vagas
certas. Mudar as vagas é só editar o `eventos-meta.json` e publicar; nada para
mexer no script. Eventos sem `vagas` definidas usam o `LIMITE_PADRAO`.

Como funciona: a cada 10 minutos varre as planilhas **"Inscrição"** (respostas
dos Forms) na pasta de relatórios; baixa o `eventos-meta.json`, casa cada
planilha com o evento **pela pasta**, e fecha o form vinculado quando o total de
inscritos ≥ vagas do evento.

Arquivo: `fecharInscricoesLotadas.gs` — é um **projeto Apps Script próprio**
(independente dos outros módulos da pasta).

## Instalação

1. https://script.google.com → **Novo projeto**. Apague o `Code.gs` e cole o
   conteúdo de `fecharInscricoesLotadas.gs`.
2. Ajuste no topo:
   - `ROOT_FOLDER_ID` — pasta "relatorios" (a mesma do `confirmacaoInscricao.gs`).
   - `META_URL` — URL pública do `eventos-meta.json` (padrão já aponta para o
     deploy: `…/assets/docs/relatorios/eventos-meta.json`).
   - `LIMITE_PADRAO` — fallback só para eventos sem `vagas` ou sem match.
   - `AVISO_PARA` — quem recebe o e-mail ao fechar (padrão: Fabiana).
     `AVISAR_EMAIL = false` desliga o aviso. Rode `avisarFechamentoTeste` para
     ver o visual do e-mail.
3. **Mantenha `DRY_RUN = true`** e rode `diagnosticarFormsLotados`. Autorize as
   permissões (Drive, Sheets, **Forms**, **Gmail**, **conexões externas/UrlFetch**).
   Veja em **Execuções → Registros**: cada form aparece como
   `"<pasta>": <inscritos>/<vagas> [evento "<id>"] | form: ABERTO | >>> FECHARIA`
   (ou `(mantém)`). Nada é alterado e nenhum e-mail é enviado.
4. Com os números conferidos, troque para **`DRY_RUN = false`** e rode
   `instalarGatilhoFecharForms` **uma vez** (gatilho de 10 em 10 min).

## De onde vêm as vagas

- Fonte única: `eventos-meta.json` → campo `vagas` por evento (ex.: Workshop SEI
  = 80, Comissão Recursal = 4, Comunicação que aproxima = 40, Gestão para
  Resultados = 50...).
- O match planilha↔evento é pela **pasta**: a chave do meta (ex.:
  `comissao-recursal-2026-05/turma 1/participantes.xlsx`) tem o mesmo diretório
  da planilha "Inscrição" daquele evento. A comparação ignora acentos e
  maiúsculas/minúsculas.
- Se um form não casar com nenhum evento (ou o evento não tiver `vagas`), usa o
  `LIMITE_PADRAO` — e o diagnóstico marca como `PADRÃO (sem match)`, para você
  ajustar o `eventos-meta.json` se quiser.

## Aviso por e-mail + notificação no painel

- **E-mail (Fabiana):** ao fechar um form, envia um e-mail no padrão
  institucional (logo, cores EGOV-PL) para `AVISO_PARA`, com o evento, as vagas,
  o total de inscritos e o horário do encerramento. Configurável por
  `AVISAR_EMAIL`. Só dispara com `DRY_RUN = false`.
- **Notificação no dashboard:** o painel mostra um alerta de **"inscrições
  lotadas"** no sino do topo quando um evento com inscrição aberta atinge as
  vagas (total ao vivo ≥ vagas). Isso é independente deste script — o painel
  calcula sozinho comparando os inscritos ao vivo com as vagas do
  `eventos-meta.json`.
  - **Requer republicar o `servirInscricoes.gs`**: o manifesto agora inclui o
    `total` de inscritos por planilha (é o que o painel usa para detectar o
    "lotado"). Atualize a implantação Web App desse script (**Implantar →
    Gerenciar implantações → editar → Nova versão**).

## Requisitos importantes

- A conta que **autoriza** precisa ter acesso de **EDIÇÃO** aos formulários
  (ser dono/editor). Sem isso o fechamento falha e fica só no log.
- A planilha "Inscrição" tem de ser a **destinatária de respostas** do Form.
  Planilhas avulsas não têm form vinculado (`getFormUrl()` vazio) e são
  ignoradas com aviso.
- O total conta **linhas com e-mail preenchido** (mesma regra do
  `confirmacaoInscricao.gs`), para bater com o número do painel.

## Observações

- O fechamento é **por formulário** (cada planilha "Inscrição" = um form).
- Reabrir um form manualmente enquanto ele ainda tem inscritos ≥ vagas faz o
  gatilho fechá-lo de novo na próxima rodada (é um teto rígido). Para liberar
  vagas extras, aumente o `vagas` no `eventos-meta.json` (e publique) ou pause
  o gatilho.
- Intervalo padrão: 10 min (não é instantâneo). Para fechar **na hora**, dá para
  usar um gatilho instalável `onFormSubmit` na planilha de respostas de cada
  form — mas exige 1 gatilho por planilha. O gatilho de tempo é centralizado e
  cobre todos os forms de uma vez.
