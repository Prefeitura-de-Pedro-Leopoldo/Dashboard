/**
 * servidores.js - lógica de domínio (pura, sem DOM) sobre servidores/pessoas:
 * agregação de presenças por servidor entre eventos, cargos, badges e métricas
 * derivadas. Consumido pelas views de Pessoas (Servidores/Cargos), Insights e
 * pelo perfil do servidor.
 */

// Chave estável para identificar um servidor entre eventos. Preferência:
// e-mail (lowercased). Fallback: nome normalizado (sem acentos, lower).
export function chaveServidor(p) {
  const email = String(p.email || "").trim().toLowerCase()
  if (email && !/^user-anonymous/i.test(email)) return "e:" + email
  const nome = String(p.nome || "").trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ")
  if (nome) return "n:" + nome
  return null
}

// Agrega presenças únicas de cada servidor através de todos os eventos.
// Retorna [{ chave, nome, email, secretaria, cargo, eventos: [{id,title,date,presente}], totalEventos, totalPresentes }, ...]
export function agregarServidores(eventos) {
  const mapa = new Map()
  eventos.forEach(ev => {
    (ev.participantes || []).forEach(p => {
      const k = chaveServidor(p)
      if (!k) return
      let entry = mapa.get(k)
      if (!entry) {
        entry = {
          chave: k,
          nome: p.nome || "",
          email: p.email || "",
          secretaria: p.secretaria || "",
          cargo: p.cargo || "",
          eventos: [],
          totalEventos: 0,
          totalPresentes: 0
        }
        mapa.set(k, entry)
      }
      // Usa o nome mais bonito (mais longo) quando há variações
      if ((p.nome || "").length > entry.nome.length) entry.nome = p.nome
      if (!entry.email && p.email) entry.email = p.email
      if (!entry.secretaria && p.secretaria) entry.secretaria = p.secretaria
      if (!entry.cargo && p.cargo) entry.cargo = p.cargo
      entry.eventos.push({
        id: ev.id,
        title: ev.title,
        date: ev.date,
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
  })
  return [...mapa.values()]
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

// Estima carga horária total. Como eventos-data.json não traz cargaHoraria
// explícita, faz uma estimativa conservadora de 8h por presença confirmada.
// Se a fonte trouxer ev.cargaHoraria no futuro, é só consumir aqui.
export function estimarHorasServidor(s) {
  return s.eventos.reduce((acc, ev) => acc + (ev.presente ? 8 : 0), 0)
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
