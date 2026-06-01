# Sobe o ambiente local (vercel dev) carregando as variaveis do .env.local
# na sessao. Use porque o `vercel dev` nao injeta o .env.local sozinho quando
# o projeto esta linkado.
#
# Como usar (na raiz do projeto):
#   .\scripts\dev.ps1

$envFile = Join-Path $PSScriptRoot "..\.env.local"
if (-not (Test-Path $envFile)) {
  Write-Error ".env.local nao encontrado em $envFile"
  exit 1
}

Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?(.*?)"?\s*$') {
    Set-Item -Path "env:$($matches[1])" -Value $matches[2]
  }
}

Write-Host "[dev] variaveis carregadas do .env.local. Subindo vercel dev..." -ForegroundColor Green
vercel dev
