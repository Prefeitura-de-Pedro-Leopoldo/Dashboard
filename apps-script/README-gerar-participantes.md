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
   - `ROOT_FOLDER_ID` — pasta raiz onde ficam as pastas dos eventos (a **mesma**
     das planilhas Inscrição/Presentes; já vem com a ID `1Jfyl8j…` usada pelos
     outros scripts).
   - `META_URL` — URL do `eventos-meta.json` publicado.
   - `HORAS_APOS_EVENTO` — padrão `3`.
3. **Habilite o Drive API**: no editor, *Serviços* (＋) → **Drive API** → adicionar
   (identificador `Drive`).
4. Rode **`instalarGatilho()`** e autorize (Drive + acesso externo).
5. (Opcional, teste) Rode **`gerarParticipantesAgora()`** para gerar na hora de
   todos os eventos com Inscrição+Presentes (ainda respeitando "não regerar quem
   já tem dados"), ignorando só a janela de 3h.

## Qual raiz do Drive usar (decisão)

O projeto tem duas raízes no Drive:

| Raiz | ID | Usada por | Conteúdo |
|------|----|-----------|----------|
| `relatorios` | `1Jfyl8j…` | `servirInscricoes.gs`, `confirmacaoInscricao.gs`, **este script** | Inscrição + Presentes + participantes.xlsx **na mesma pasta do evento** |
| `Relatorios EGov` | `1F6omx…` | `servirRelatorios.gs` (build/`/api/eventos`) | só os `.xlsx` de relatório |

O design (ver `README-inscricoes.md`) é **uma pasta por evento com tudo junto** →
a raiz correta é a **`1Jfyl8j`**. Por isso o gerador lê e grava nela.

> ⚠️ **Unifique as raízes:** para o `participantes.xlsx` gerado aparecer no
> painel, o `servirRelatorios.gs` precisa ler **a mesma** pasta. Confirme se
> `1F6omx` e `1Jfyl8j` são a mesma pasta (abra as duas URLs
> `drive.google.com/drive/folders/<ID>`); se forem diferentes, troque o
> `ROOT_FOLDER_ID` do `servirRelatorios.gs` para `1Jfyl8j` e republique aquele
> Web App. Assim Inscrição, Presentes e participantes.xlsx ficam todos numa raiz
> só — fonte única da verdade.

## Resultado no dashboard

Antes do evento: sem `participantes.xlsx` (ou vazio) → card aparece como
**Inscrição aberta** (abas Inscrições / Encontros & Lembretes / Presença).
Depois do evento (+3h): o arquivo é gerado com os check-ins → o card passa a
exibir **presença e análises** normalmente.
