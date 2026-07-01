/**
 * servidores.js - lógica de domínio (pura, sem DOM) sobre servidores/pessoas:
 * agregação de presenças por servidor entre eventos, cargos, badges e métricas
 * derivadas. Consumido pelas views de Pessoas (Servidores/Cargos), Insights e
 * pelo perfil do servidor.
 */

// Sinais de identidade de um participante, normalizados:
//   email: lowercased (ignora user-anonymous) · nome: sem acentos, minúsculo.
function sinaisServidor(p) {
  const emailRaw = String(p.email || "").trim().toLowerCase()
  const email = emailRaw && !/^user-anonymous/i.test(emailRaw) ? emailRaw : ""
  const nome = String(p.nome || "").trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ")
  return { email, nome }
}

// Chave estável de um participante (e:email preferido, senão n:nome).
// Continua usada para gerar data-servidor-chave por participante; a busca
// do perfil resolve qualquer uma das chaves do servidor unificado.
export function chaveServidor(p) {
  const { email, nome } = sinaisServidor(p)
  if (email) return "e:" + email
  if (nome) return "n:" + nome
  return null
}

// Agrega presenças únicas de cada servidor através de todos os eventos.
// Une participações que compartilham E-MAIL **ou** NOME normalizado (union-find):
// trata tanto e-mails diferentes para o mesmo nome (ex.: Polyana com 2 e-mails)
// quanto o mesmo e-mail com o nome digitado diferente.
// Retorna [{ chave, chaves:[...], nome, email, secretaria, cargo,
//            eventos:[{id,title,date,presente,...}], totalEventos, totalPresentes }, ...]
export function agregarServidores(eventos) {
  // ---- Union-find sobre as chaves de sinal (e:email / n:nome) ----
  const parent = new Map()
  const ensure = (x) => { if (!parent.has(x)) parent.set(x, x) }
  const find = (x) => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)
    while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n }
    return r
  }
  const union = (a, b) => { ensure(a); ensure(b); parent.set(find(a), find(b)) }

  // 1ª passada: registra participações e une seus sinais.
  const partes = []
  eventos.forEach(ev => {
    (ev.participantes || []).forEach(p => {
      const { email, nome } = sinaisServidor(p)
      const eKey = email ? "e:" + email : null
      const nKey = nome ? "n:" + nome : null
      const anchor = eKey || nKey
      if (!anchor) return
      ensure(anchor)
      if (eKey && nKey) union(eKey, nKey)
      partes.push({ ev, p, eKey, nKey, anchor })
    })
  })

  // 2ª passada: agrega por componente (raiz do union-find).
  const mapa = new Map()
  partes.forEach(({ ev, p, eKey, nKey, anchor }) => {
    const root = find(anchor)
    let entry = mapa.get(root)
    if (!entry) {
      entry = {
        chave: root,
        chaves: new Set(),
        nome: p.nome || "",
        email: "",
        secretaria: p.secretaria || "",
        cargo: p.cargo || "",
        eventos: [],
        totalEventos: 0,
        totalPresentes: 0
      }
      mapa.set(root, entry)
    }
    if (eKey) entry.chaves.add(eKey)
    if (nKey) entry.chaves.add(nKey)
    // Usa o nome mais bonito (mais longo) quando há variações
    if ((p.nome || "").length > entry.nome.length) entry.nome = p.nome
    const emailLimpo = sinaisServidor(p).email
    if (!entry.email && emailLimpo) entry.email = p.email
    if (!entry.secretaria && p.secretaria) entry.secretaria = p.secretaria
    if (!entry.cargo && p.cargo) entry.cargo = p.cargo
    entry.eventos.push({
      id: ev.id,
      title: ev.title,
      date: ev.date,
      cargaHoraria: ev.cargaHoraria ?? null,
      presente: !!p.presente,
      turma: p.turma || "",
      dataCheckin: p.dataCheckin || null,
      dataInscricao: p.dataInscricao || null,
      local: ev.local || "",
      time: ev.time || ""
    })
    entry.totalEventos += 1
    if (p.presente) entry.totalPresentes += 1
  })
  // chaves vira array (serializável e fácil de usar com includes)
  return [...mapa.values()].map(e => ({ ...e, chaves: [...e.chaves] }))
}

// Iniciais para o avatar.
export function iniciaisDoNome(nome) {
  if (!nome) return "?"
  const partes = String(nome).trim().split(/\s+/).filter(Boolean)
  if (!partes.length) return "?"
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

// Frequência mensal: { "2026-04": N, "2026-05": N, ... } - apenas presenças.
export function frequenciaMensal(eventos) {
  const map = new Map()
  eventos.forEach(ev => {
    if (!ev.presente || !ev.date) return
    const m = ev.date.match(/^(\d{4})-(\d{2})/)
    if (!m) return
    const key = `${m[1]}-${m[2]}`
    map.set(key, (map.get(key) || 0) + 1)
  })
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({ mes: k, qtd: v }))
}

// Badges automáticas com base na trajetória do servidor.
export function badgesDoServidor(s) {
  const out = []
  if (s.totalPresentes >= 1)  out.push({ icon: "fa-star", label: "Primeiro evento", cls: "badge-bronze" })
  if (s.totalPresentes >= 3)  out.push({ icon: "fa-fire", label: "Engajado",       cls: "badge-silver" })
  if (s.totalPresentes >= 5)  out.push({ icon: "fa-trophy", label: "Veterano",     cls: "badge-gold" })
  if (s.totalPresentes >= 10) out.push({ icon: "fa-crown", label: "Líder de capacitação", cls: "badge-diamond" })
  if (s.totalEventos > 0 && s.totalPresentes === s.totalEventos && s.totalEventos >= 2) {
    out.push({ icon: "fa-bullseye", label: "Pontualidade 100%", cls: "badge-green" })
  }
  if (s.totalEventos > 0 && s.totalPresentes === 0) {
    out.push({ icon: "fa-triangle-exclamation", label: "Sem comparecimentos", cls: "badge-warn" })
  }
  return out
}

// Soma a carga horária dos eventos em que o servidor esteve presente.
// Usa a carga real (ev.cargaHoraria, vinda do eventos-meta.json); se algum
// evento não tiver carga informada, cai para 8h como estimativa só naquele.
export function estimarHorasServidor(s) {
  return s.eventos.reduce((acc, ev) => acc + (ev.presente ? (ev.cargaHoraria ?? 8) : 0), 0)
}

// Indica se TODOS os eventos presentes têm carga horária informada (real).
export function horasSaoReais(s) {
  const presentes = s.eventos.filter((ev) => ev.presente)
  return presentes.length > 0 && presentes.every((ev) => ev.cargaHoraria != null)
}

// Normaliza um cargo para Title Case + remove caracteres redundantes.
// Não inventa dados - só padroniza formatação para agrupar variantes
// como "COORDENAÇÃO" / "Coordenação" / "coordenacao".
export function normalizarCargo(raw) {
  if (!raw) return null
  const s = String(raw).trim().replace(/\s+/g, " ")
  if (!s) return null
  const LOWER = new Set(["de", "da", "do", "dos", "das", "e"])
  return s.toLowerCase().split(" ").map((w, i) => {
    if (i > 0 && LOWER.has(w)) return w
    return w[0] ? w[0].toUpperCase() + w.slice(1) : w
  }).join(" ")
}

// Agrega cargos a partir de todos os participantes (sem deduplicar por
// servidor - conta inscrições). Retorna [{ label, value }] ordenado.
export function agregarCargos(eventos) {
  const cont = new Map()
  eventos.forEach(ev => {
    (ev.participantes || []).forEach(p => {
      const c = normalizarCargo(p.cargo)
      if (!c) return
      cont.set(c, (cont.get(c) || 0) + 1)
    })
  })
  return [...cont.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
}

// Classifica um cargo bruto como "Comissionado" ou "Efetivo".
// Heurística baseada nos dados reais das planilhas:
//  - Qualquer marcação DCA (DCA 1, DCA-3, DCA1, Dca_1, "...dca 3...") → comissionado;
//  - Cargos de direção/chefia/assessoria/gerência/coordenação/supervisão e o
//    literal "Comissionado"/"Estagiário" → comissionado;
//  - Os demais (Assistente/Analista/Auxiliar/Agente Administrativo, técnicos,
//    enfermeiros, etc.) → efetivo.
// Cargo vazio/sem informação retorna null (não entra na contagem).
export function classificarVinculo(raw) {
  if (!raw) return null
  const s = String(raw).toLowerCase()
  if (!s.trim()) return null
  // DCA aparece como "dca 1", "dca-3", "dca1", "dca_1" e embutido em frases.
  if (/\bdca[\s\-_]?\d+/i.test(s) || /\bdca\b/.test(s)) return "Comissionado"
  const COMISSIONADO = [
    "comissionad", "diretor", "diretora", "gerente", "gerência", "gerencia",
    "coordenador", "coordenadora", "coordenação", "coordenacao",
    "supervisor", "supervisora", "supervisão", "supervisao",
    "assessor", "assessora", "assessoria", "chefe", "secretário", "secretario",
    "secretária", "secretaria adjunt", "adjunto", "ouvidor", "ouvidora",
    "controlador", "controladora", "estagi", "social mídia", "social midia"
  ]
  if (COMISSIONADO.some(t => s.includes(t))) return "Comissionado"
  return "Efetivo"
}

// Agrega inscrições por vínculo (Efetivo / Comissionado), a partir de todos
// os participantes. Retorna [{ label, value }] ordenado por value desc.
export function agregarVinculos(eventos) {
  const cont = new Map([["Efetivo", 0], ["Comissionado", 0]])
  eventos.forEach(ev => {
    (ev.participantes || []).forEach(p => {
      const v = classificarVinculo(p.cargo)
      if (!v) return
      cont.set(v, (cont.get(v) || 0) + 1)
    })
  })
  return [...cont.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
}

// Agrega vínculo (Comissionado / Efetivo / Não informado) por SERVIDOR ÚNICO,
// não por inscrição. Cada servidor é contado uma vez, classificado pelo seu
// cargo representativo. Garante que a soma feche com o total de servidores
// únicos (diferente de agregarVinculos, que conta inscrições). Cargos sem
// informação entram como "Não informado" para não sumir da contagem.
export function agregarVinculosServidores(servidores) {
  const cont = new Map([["Comissionado", 0], ["Efetivo", 0], ["Não informado", 0]])
  servidores.forEach(s => {
    const v = classificarVinculo(s.cargo) || "Não informado"
    cont.set(v, (cont.get(v) || 0) + 1)
  })
  return [...cont.entries()]
    .map(([label, value]) => ({ label, value }))
    .filter(x => x.value > 0)
    .sort((a, b) => b.value - a.value)
}

// Taxa de retenção: % de servidores únicos que participaram (presentes)
// em 2 ou mais eventos.
export function taxaRetencao(servidores) {
  const presentesEmAlgumEvento = servidores.filter(s => s.totalPresentes >= 1)
  if (!presentesEmAlgumEvento.length) return { pct: 0, unicos: 0, retidos: 0 }
  const retidos = presentesEmAlgumEvento.filter(s => s.totalPresentes >= 2).length
  return {
    pct: (retidos / presentesEmAlgumEvento.length) * 100,
    unicos: presentesEmAlgumEvento.length,
    retidos
  }
}

// Contagem de SERVIDORES ÚNICOS por secretaria em todos os eventos. Cada pessoa
// é contada uma vez (dedup por email/nome via agregarServidores), atribuída à
// sua secretaria representativa; sem secretaria informada entra como
// "Não informado". Retorna [{ nome, qtd }] ordenado por qtd desc — pronto para
// barSecretarias. Diferente de rankingSecretarias, que conta inscrições.
export function unicosPorSecretaria(eventos) {
  const cont = new Map()
  agregarServidores(eventos).forEach(s => {
    const sec = (s.secretaria || "").trim() || "Não informado"
    cont.set(sec, (cont.get(sec) || 0) + 1)
  })
  return [...cont.entries()]
    .map(([nome, qtd]) => ({ nome, qtd }))
    .sort((a, b) => b.qtd - a.qtd)
}

// Contagem de servidores ÚNICOS por secretaria dentro de UM evento. Deduplica os
// participantes do próprio evento por chaveServidor (mesma pessoa em 2 turmas
// conta 1 vez); sem secretaria entra como "Não informado". Retorna [{ nome, qtd }]
// ordenado por qtd desc.
export function unicosPorSecretariaEvento(ev) {
  const vistos = new Map() // chave do servidor -> secretaria (a 1ª encontrada)
  ;(ev.participantes || []).forEach(p => {
    const chave = chaveServidor(p) || ("i:" + (p.email || p.nome || Math.random()))
    if (vistos.has(chave)) return
    vistos.set(chave, (p.secretaria || "").trim() || "Não informado")
  })
  const cont = new Map()
  for (const sec of vistos.values()) cont.set(sec, (cont.get(sec) || 0) + 1)
  return [...cont.entries()]
    .map(([nome, qtd]) => ({ nome, qtd }))
    .sort((a, b) => b.qtd - a.qtd)
}

// Filtra a lista de servidores agregados por uma janela de tempo, olhando as
// datas dos eventos de cada servidor. Janelas rolantes a partir de hoje:
//   "mensal" = 30 dias · "trimestral" = 90 · "semestral" = 180 · "todos" = tudo.
// Recalcula totalEventos/totalPresentes só com os eventos dentro da janela e
// descarta quem ficou sem nenhum evento no período. Não muta a entrada original.
export function filtrarServidoresPorPeriodo(servidores, periodo) {
  const dias = { mensal: 30, trimestral: 90, semestral: 180 }[periodo]
  if (!dias) return servidores // "todos" ou valor desconhecido: sem filtro
  const corte = Date.now() - dias * 24 * 60 * 60 * 1000
  const out = []
  for (const s of servidores) {
    const eventos = (s.eventos || []).filter(ev => {
      if (!ev.date) return false
      const t = Date.parse(ev.date)
      return Number.isFinite(t) && t >= corte
    })
    if (!eventos.length) continue
    out.push({
      ...s,
      eventos,
      totalEventos: eventos.length,
      totalPresentes: eventos.filter(ev => ev.presente).length
    })
  }
  return out
}
