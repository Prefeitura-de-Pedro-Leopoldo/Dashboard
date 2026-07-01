// Lógica de eventos ao vivo (testável). Orquestra: baixa as planilhas do Drive,
// processa cada uma com o MESMO pipeline do build (injetado) e monta o mesmo
// formato do eventos-data.json. Contrato idêntico ao GET /api/eventos.
import { Buffer } from "node:buffer";
import { jsonResponse, preflight } from "../_shared/http.ts";
import type { FetchLike } from "../_shared/appscript.ts";

const PREFIXO = "assets/docs/relatorios/";
const relativo = (p: string) =>
  String(p).replace(/\\/g, "/").replace(/^\/+/, "").replace(new RegExp("^" + PREFIXO, "i"), "");
function baseNorm(rel: string): string {
  return String(rel.split("/").pop() || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function ehParticipantes(rel: string): boolean {
  const base = baseNorm(rel);
  if (!base.endsWith(".xlsx") || base.startsWith("~$")) return false;
  if (base.startsWith("satisfacao") || base.startsWith("pesquisa")) return false;
  return true;
}
function ehSatisfacao(rel: string): boolean {
  const base = baseNorm(rel);
  if (!base.endsWith(".xlsx") || base.startsWith("~$")) return false;
  return base.startsWith("satisfacao") || base.startsWith("pesquisa");
}
const dirDe = (rel: string) => rel.replace(/\/[^/]*$/, "");
async function getJson(url: string, fetchImpl: FetchLike): Promise<{ ok?: boolean; [k: string]: unknown }> {
  const r = await fetchImpl(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}

// deno-lint-ignore no-explicit-any
type Any = any;

export interface EventosDeps {
  webappUrl: string;
  token: string;
  metaUrl: string;
  fetchImpl?: FetchLike;
  processarArquivo: (bytes: Uint8Array, arquivo: string, metaEntry: Any) => Any; // pode lançar "Cabeçalho..."
  buildEvento: (arquivo: string, meta: Any, participantes: unknown[]) => Any;
  buildResumo: (eventos: unknown[]) => unknown;
  parseSatisfacao: (bytes: Uint8Array) => Any;
  slugify: (s: string) => string;
  now?: () => string;
}

export async function handleEventos(req: Request, deps: EventosDeps): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "GET") return jsonResponse({ ok: false, error: "Método não permitido." }, 405);
  if (!deps.webappUrl || !deps.token) return jsonResponse({ ok: false, error: "Relatórios ao vivo não configurados." }, 503);

  try {
    const [manifest, meta] = await Promise.all([
      getJson(`${deps.webappUrl}?action=manifest&token=${encodeURIComponent(deps.token)}`, fetchImpl),
      getJson(deps.metaUrl, fetchImpl).then((m: Any) => (m && m.eventos) || {}).catch(() => ({})),
    ]);
    if (!manifest.ok) throw new Error(String(manifest.error || "Falha no manifesto do Drive."));

    const files = ((manifest.files as Any[]) || []).map((f) => ({ ...f, rel: relativo(f.path) }));
    const arquivos = files.filter((f) => ehParticipantes(f.rel));
    const satArquivos = files.filter((f) => ehSatisfacao(f.rel));

    const baixar = (f: Any) =>
      getJson(`${deps.webappUrl}?action=file&token=${encodeURIComponent(deps.token)}&id=${encodeURIComponent(f.id)}`, fetchImpl)
        .then((d: Any) => (d && d.ok && d.base64 ? Buffer.from(d.base64, "base64") : null))
        .catch(() => null);

    const [buffers, satBuffers] = await Promise.all([
      Promise.all(arquivos.map(baixar)),
      Promise.all(satArquivos.map(baixar)),
    ]);

    const satPorPasta = new Map<string, Any>();
    for (let i = 0; i < satArquivos.length; i++) {
      if (!satBuffers[i]) continue;
      const s = deps.parseSatisfacao(satBuffers[i]!);
      if (s) satPorPasta.set(dirDe(satArquivos[i].rel), s);
    }
    const anexarSat = (evento: Any, arquivo: string) => {
      const s = satPorPasta.get(dirDe(arquivo));
      if (s && evento) evento.satisfacao = s;
      return evento;
    };

    const eventos: Any[] = [];
    const m = meta as Record<string, Any>;
    for (let i = 0; i < arquivos.length; i++) {
      const arquivo = arquivos[i].rel;
      const buf = buffers[i];
      if (!buf) continue;
      const metaEntry = m[arquivo] || {};
      if (metaEntry.ignore) continue;
      try {
        const evento = deps.processarArquivo(buf, arquivo, metaEntry);
        if (evento) eventos.push(anexarSat(evento, arquivo));
      } catch (err) {
        const semCabecalho = /Cabeçalho não (reconhecido|encontrado)/.test((err as Error)?.message || "");
        if (semCabecalho && m[arquivo]) {
          try {
            const defaults = {
              id: deps.slugify(arquivo.replace(/\.xlsx$/i, "").replace(/\//g, "-")),
              title: arquivo.replace(/\.xlsx$/i, "").replace(/\//g, " · "),
            };
            eventos.push(anexarSat(deps.buildEvento(arquivo, { ...defaults, ...metaEntry }, []), arquivo));
          } catch (_) { /* ignora */ }
        }
      }
    }

    const arquivosSet = new Set(arquivos.map((f) => f.rel));
    for (const [chave, mm] of Object.entries(m)) {
      if (!mm || !mm.placeholder || mm.ignore || arquivosSet.has(chave)) continue;
      try {
        const defaults = {
          id: deps.slugify(chave.replace(/\.xlsx$/i, "").replace(/\//g, "-")),
          title: chave.replace(/\.xlsx$/i, "").replace(/\//g, " · "),
        };
        eventos.push(anexarSat(deps.buildEvento(chave, { ...defaults, ...mm }, []), chave));
      } catch (_) { /* ignora */ }
    }

    eventos.sort((a, b) => {
      if (a.date && b.date) return String(a.date).localeCompare(String(b.date));
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    });

    return jsonResponse({
      geradoEm: deps.now ? deps.now() : new Date().toISOString(),
      fonte: "drive (ao vivo)",
      eventos,
      resumo: deps.buildResumo(eventos),
    }, 200);
  } catch (err) {
    return jsonResponse({ ok: false, error: (err as Error)?.message || "Erro ao montar eventos." }, 502);
  }
}
