# Gerar `participantes.xlsx` automaticamente

Script: **`gerarParticipantes.gs`** (projeto Apps Script standalone, separado dos demais).

## O que faz

Para cada pasta de evento no Drive que tenha as planilhas **Inscrição** e
**Presentes**, gera o arquivo `participantes.xlsx` (que o dashboard lê), juntando:

| Campo | Vem de |
|-------|--------|
| Nome, e-mail, secretaria, cargo, matrícula, tipo de ingresso… | **Inscrição** (base) |
| Data de inscrição | carimbo de data/hora da **Inscrição** |
| **Check-in** = `Sim`/`Não` | a pessoa aparece na **Presentes**? |
| **Data de check-in** | carimbo (mais antigo) da pessoa na **Presentes** |

**Regra do Check-in (robusta):** `Sim` se a pessoa da Inscrição casa com alguém
da Presentes **por e-mail OU por nome** (sem acento/maiúsculas). Basta um dos dois
bater — cobre quem se inscreveu com e-mail diferente ou nome com erro de digitação.

## Quando gera

- Roda por **gatilho de tempo (de hora em hora)**.
- Só gera depois de **3h após o evento TERMINAR** (`HORAS_APOS_EVENTO`). O fim =
  início (`date` + `time` do `eventos-meta.json`) **+ duração** (`cargaHoraria`),
  e ainda considera o **último check-in** da Presentes (usa o que for mais tarde).
  Ex.: evento 09h30 com 3h de duração → termina 12h30 → gera **15h30**.
- **Não regera** eventos que já têm um `participantes.xlsx` **com dados reais** —
  os eventos já encerrados/exportados ficam intactos. Só gera para quem está
  **sem arquivo** ou com o **placeholder vazio** (o `participantes.xlsx` só com
  cabeçalho, criado para o evento aparecer na Visão Geral antes de acontecer).
- Substitui o placeholder vazio pelo arquivo final (não duplica).
- Funciona para **qualquer** pasta/turma nova automaticamente (ex.: uma `turma 3`
  nova de um curso) — basta ter Inscrição + Presentes na pasta.

> A distinção "tem dados × placeholder vazio" usa o **Drive API (Serviço
> avançado)**: o script converte o `.xlsx` numa planilha temporária e conta as
> linhas. Habilite-o no setup (passo 3).

## Setup (uma vez)

1. Crie um projeto em <https://script.google.com> e cole o conteúdo de
   `gerarParticipantes.gs`.
2. Confira as constantes no topo:
   - `INSCRICOES_ROOT_ID` — **entrada**: pasta com as pastas dos eventos e as
     planilhas Inscrição/Presentes (`1Jfyl8j…`, a mesma dos outros scripts).
   - `RELATORIOS_ROOT_ID` — **saída**: pasta que o dashboard lê os relatórios
     (`1F6omx…`, "Relatorios EGov").
   - `RELATORIOS_SUBPATH` — subpasta dentro da saída onde ficam as pastas de
     evento (`assets/docs/relatorios`).
   - `META_URL` — URL do `eventos-meta.json` publicado.
   - `HORAS_APOS_EVENTO` — padrão `3`.
3. **Habilite o Drive API**: no editor, *Serviços* (＋) → **Drive API** → adicionar
   (identificador `Drive`).
4. Rode **`instalarGatilho()`** e autorize (Drive + acesso externo).
5. (Opcional, teste) Rode **`gerarParticipantesAgora()`** para gerar na hora de
   todos os eventos com Inscrição+Presentes (ainda respeitando "não regerar quem
   já tem dados"), ignorando só a janela de 3h.

## As duas raízes do Drive (por que ler de uma e gravar na outra)

O projeto tem duas pastas raiz **diferentes**:

| Raiz | ID | Papel | Estrutura |
|------|----|-------|-----------|
| `1Jfyl8j…` | **ENTRADA** | planilhas **Inscrição/Presentes** (`servirInscricoes.gs`) | pastas de evento direto na raiz |
| `1F6omx…` ("Relatorios EGov") | **SAÍDA** | `.xlsx` que o **dashboard lê** (`servirRelatorios.gs`) | `assets/docs/relatorios/<evento>/` |

Como são pastas distintas, o gerador **lê** as planilhas da entrada (`1Jfyl8j`) e
**grava** o `participantes.xlsx` na saída (`1F6omx`), no caminho
`assets/docs/relatorios/<mesma pasta do evento>/` — criando as subpastas que
faltarem. Assim o arquivo aparece no painel sem você mover nada manualmente.

> Se um dia você **unificar** tudo numa pasta só, basta apontar
> `INSCRICOES_ROOT_ID` e `RELATORIOS_ROOT_ID` para o mesmo ID e ajustar
> `RELATORIOS_SUBPATH` (`''` se os eventos ficarem direto na raiz).

## Resultado no dashboard

Antes do evento: sem `participantes.xlsx` (ou vazio) → card aparece como
**Inscrição aberta** (abas Inscrições / Encontros & Lembretes / Presença).
Depois do evento (+3h): o arquivo é gerado com os check-ins → o card passa a
exibir **presença e análises** normalmente.
