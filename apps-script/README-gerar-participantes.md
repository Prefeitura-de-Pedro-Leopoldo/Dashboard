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
- Só gera depois de **3h após a data/hora do evento** (`HORAS_APOS_EVENTO`),
  lida do `eventos-meta.json` publicado. Se não houver data no meta, usa o
  **último check-in** da planilha Presentes como referência.
- **Regera** se Inscrição/Presentes forem editadas depois do último arquivo gerado;
  caso contrário, pula (não fica refazendo à toa).
- Substitui o `participantes.xlsx` anterior (não duplica).

## Setup (uma vez)

1. Crie um projeto em <https://script.google.com> e cole o conteúdo de
   `gerarParticipantes.gs`.
2. Confira as constantes no topo:
   - `ROOT_FOLDER_ID` — pasta raiz onde ficam as pastas dos eventos (a **mesma**
     das planilhas Inscrição/Presentes; já vem com a ID usada pelos outros scripts).
   - `META_URL` — URL do `eventos-meta.json` publicado.
   - `HORAS_APOS_EVENTO` — padrão `3`.
3. Rode **`instalarGatilho()`** e autorize (Drive + acesso externo).
4. (Opcional, teste) Rode **`gerarParticipantesAgora()`** para gerar na hora de
   todos os eventos com Inscrição+Presentes, ignorando a janela de 3h.

> ⚠️ **Verifique uma vez:** confirme que a pasta onde o `participantes.xlsx` é
> gravado é a **mesma** que o dashboard lê os relatórios (web app
> `servirRelatorios.gs`). Se os relatórios usarem uma raiz diferente da das
> inscrições, ajuste `ROOT_FOLDER_ID` (ou unifique as raízes) para que o arquivo
> gerado apareça no painel.

## Resultado no dashboard

Antes do evento: sem `participantes.xlsx` (ou vazio) → card aparece como
**Inscrição aberta** (abas Inscrições / Encontros & Lembretes / Presença).
Depois do evento (+3h): o arquivo é gerado com os check-ins → o card passa a
exibir **presença e análises** normalmente.
