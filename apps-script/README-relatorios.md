# Relatórios no Drive (servirRelatorios.gs)

Permite que os arquivos `.xlsx` de relatórios fiquem **no Google Drive** (fonte
da verdade) em vez de versionados no repositório. O **build da Vercel baixa** os
arquivos na hora de publicar, então tudo continua funcionando: dashboard,
Certificados ("Do sistema") e Auto-Relatório.

```
Drive (pasta relatorios)  ──>  servirRelatorios.gs (Web App)  ──>  build da Vercel
                                                                  (pull-relatorios.mjs)
                                                                        │
                                                  recria assets/docs/relatorios/**/*.xlsx
                                                  e gera eventos-data.json + manifest.json
```

## O que vai para o Drive e o que fica no repositório

- **Vão para o Drive:** todos os `.xlsx` (participantes, satisfacao, pesquisa…),
  espelhando a estrutura de subpastas de `assets/docs/relatorios/`.
- **Ficam no repositório:** `eventos-meta.json` (config dos eventos — editável) e
  `manifest.json` (gerado pelo build). **Não** coloque esses no Drive.

## Instalação

### 1. Pasta raiz no Drive
1. Crie uma pasta (ex.: `Relatorios EGov`).
2. **Suba a mesma estrutura** de `assets/docs/relatorios/` — as subpastas por
   evento/turma e os `.xlsx` dentro delas. (Arraste a pasta inteira para o Drive.)
3. Copie o ID da pasta raiz da URL: `drive.google.com/drive/folders/`**`<ID>`**.

### 2. Apps Script (standalone)
1. Em <https://script.google.com> → **Novo projeto**.
2. Cole o conteúdo de `servirRelatorios.gs`.
3. Edite no topo:
   - `ROOT_FOLDER_ID` = ID da pasta raiz.
   - `SHARED_TOKEN` = string longa aleatória. **Guarde.**
4. Salve.

### 3. Publique a Web App
1. **Implantar → Nova implantação → Aplicativo da Web**.
2. Executar como **Eu**; Quem tem acesso **Qualquer pessoa**.
3. **Implantar**, autorize (Drive) e copie a **URL `/exec`**.
4. Teste no navegador: `…/exec?action=manifest&token=SEU_TOKEN` deve listar os
   arquivos em JSON.

### 4. Variáveis na Vercel (e em `.env.local`)
| Variável | Valor |
|----------|-------|
| `RELATORIOS_WEBAPP_URL` | a URL `/exec` |
| `RELATORIOS_TOKEN`      | o mesmo `SHARED_TOKEN` |

### 5. Teste o build localmente
```bash
# com as env vars exportadas:
npm run build:pull      # baixa os .xlsx do Drive
npm run build           # pull + normalize + build-data
```
Se as env vars **não** estiverem definidas, o `pull` é pulado e o build usa os
arquivos que já estiverem em disco (não quebra o ambiente local).

## Cutover (remover os .xlsx do git) — só depois de validar

Os `.xlsx` já estão no `.gitignore`, mas o git continua rastreando os que já
estavam commitados. Quando o build pelo Drive estiver validado, remova-os do
controle de versão **sem apagar do disco**:

```bash
git rm -r --cached "assets/docs/relatorios/**/*.xlsx"
git commit -m "chore: relatorios .xlsx passam a viver no Drive"
```

A partir daí, novos `.xlsx` só precisam ir para o Drive.

## Notas

- **Token**: o endpoint só responde com o `SHARED_TOKEN` correto.
- **Atualizar o script**: ao mudar o `.gs`, faça **Nova versão** na implantação
  (a URL não muda).
- **Tamanho**: cada arquivo é entregue em base64 num request próprio; planilhas
  de participantes são pequenas (KB), bem dentro dos limites do Apps Script.
