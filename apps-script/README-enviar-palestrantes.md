# Envio de certificados de PALESTRANTES

Fluxo separado do de inscritos. Mesmo padrão (Drive + Gmail), mas com:

- **texto de e-mail próprio** (reconhecimento ao palestrante, não "participação");
- **cópia oculta (BCC)** para a Escola de Governo (`egov@pedroleopoldo.mg.gov.br`)
  e para a Fabiana (`fabiana.silva@pedroleopoldo.mg.gov.br`) em todos os envios;
- registro na **mesma planilha** dos certificados, na aba **`Palestrantes`**;
- PDFs salvos em `Drive / <pasta dos certificados> / Certificados de Palestrantes`.

## Arquivos
- `enviarCertificadosPalestrantes.gs` — Apps Script (Web App) separado.
- `../api/send-certificate-palestrante.js` — proxy interno (evita CORS).
- Front-end: aba **Certificados → Palestrantes** no dashboard.

O `.gs` **já vem todo preenchido** (planilha, pasta, BCC, token, textos). É só copiar e colar.

## Publicar (uma vez)
1. Acesse [script.google.com](https://script.google.com) → **Novo projeto**.
2. Cole o conteúdo de `enviarCertificadosPalestrantes.gs` (nada a editar).
3. (Para o Smart Chip do PDF na planilha, igual às outras abas) **Editor →
   Serviços → +  → Google Sheets API**. Sem isso, o link do PDF vira um
   HYPERLINK simples e o envio funciona do mesmo jeito.
4. **Executar** a função `autorizar()` uma vez e aceitar as permissões
   (Drive, Gmail e Planilhas). Republicar **não** concede escopo novo.
5. **Implantar → Nova implantação → App da Web**:
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
6. Copie a URL `.../exec` e me passe (ou cole no default do proxy).

## Conectar ao dashboard
Defina a env var na Vercel (Project → Settings → Environment Variables):

```
CERT_PAL_WEBAPP_URL = https://script.google.com/macros/s/SEU_ID/exec
```

(Ou, para teste local, cole a URL no default de `api/send-certificate-palestrante.js`.)

## Testar
- `DRY_RUN = true` no `.gs` simula (salva PDF, não envia e-mail).
- Abra a URL `.../exec` no navegador: deve responder
  `{ ok: true, service: 'enviarCertificadosPalestrantes' }`.
- No dashboard: **Certificados → Palestrantes**, preencha, **Enviar por e-mail**.

> O token compartilhado (`SHARED_TOKEN`) é o mesmo do envio de inscritos.
