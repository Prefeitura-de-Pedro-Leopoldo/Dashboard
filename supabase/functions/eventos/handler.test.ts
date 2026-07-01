// Testes de orquestração do eventos (pipeline pesado injetado). Cobre filtro
// participantes x satisfação, ignore, placeholder, anexo de satisfação, ordenação.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { Buffer } from "node:buffer";
import { type EventosDeps, handleEventos } from "./handler.ts";

const B64 = Buffer.from([1, 2, 3]).toString("base64");
const MANIFEST = {
  ok: true,
  files: [
    { path: "curso-b-2026-05/participantes.xlsx", id: "B" },
    { path: "curso-a-2026-04/participantes.xlsx", id: "A" },
    { path: "curso-a-2026-04/satisfacao.xlsx", id: "SAT" },
    { path: "legado/participantes.xlsx", id: "LEG" },
    { path: "vazio/participantes.xlsx", id: "VAZ" }, // sem cabeçalho
  ],
};
const META = {
  "legado/participantes.xlsx": { ignore: true },
  "vazio/participantes.xlsx": { id: "vazio-ev", title: "Vazio" },
  "futuro-2026-09/participantes.xlsx": { placeholder: true, id: "futuro", title: "Futuro", date: "2026-09-01" },
};

function deps(over: Partial<EventosDeps> = {}): EventosDeps {
  return {
    webappUrl: "https://as/exec",
    token: "TKN",
    metaUrl: "https://site/meta.json",
    // deno-lint-ignore require-await
    fetchImpl: async (url: string) => {
      if (url.includes("action=manifest")) return new Response(JSON.stringify(MANIFEST), { status: 200 });
      if (url.includes("meta.json")) return new Response(JSON.stringify({ eventos: META }), { status: 200 });
      if (url.includes("action=file")) return new Response(JSON.stringify({ ok: true, base64: B64 }), { status: 200 });
      return new Response("{}", { status: 404 });
    },
    processarArquivo: (_b, arquivo) => {
      if (arquivo.startsWith("vazio")) throw new Error("Cabeçalho não reconhecido");
      const date = arquivo.includes("curso-a") ? "2026-04-10" : "2026-05-20";
      return { id: arquivo.split("/")[0], title: arquivo, date, totalInscritos: 10 };
    },
    buildEvento: (arquivo, meta) => ({ id: (meta as { id: string }).id, title: (meta as { title: string }).title, date: (meta as { date?: string }).date || null, totalInscritos: 0 }),
    buildResumo: (evs) => ({ totalEventos: (evs as unknown[]).length }),
    parseSatisfacao: () => ({ mediaGeral: 4.5 }),
    slugify: (s) => s,
    now: () => "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

const get = (method = "GET") => new Request("http://l/eventos", { method });

Deno.test("OPTIONS/CORS; POST -> 405; sem config -> 503", async () => {
  assertEquals((await handleEventos(get("OPTIONS"), deps())).headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals((await handleEventos(get("POST"), deps())).status, 405);
  assertEquals((await handleEventos(get(), deps({ webappUrl: "" }))).status, 503);
});

Deno.test("monta eventos: ignora 'ignore', trata sem-cabeçalho, adiciona placeholder, ordena por data", async () => {
  const res = await handleEventos(get(), deps());
  assertEquals(res.status, 200);
  const j = await res.json();
  // curso-a (04), vazio(sem data->fim? tem meta sem date->null), curso-b(05), placeholder futuro(09)
  const ids = j.eventos.map((e: { id: string }) => e.id);
  assert(ids.includes("curso-a-2026-04"));
  assert(ids.includes("curso-b-2026-05"));
  assert(ids.includes("vazio-ev"));   // sem cabeçalho virou agendado via buildEvento
  assert(ids.includes("futuro"));      // placeholder
  assert(!ids.includes("legado"));     // ignore
  // ordenação por data asc (curso-a antes de curso-b antes de futuro)
  const datados = j.eventos.filter((e: { date: string | null }) => e.date).map((e: { date: string }) => e.date);
  const ordenado = [...datados].sort();
  assertEquals(datados, ordenado);
  assertEquals(j.resumo.totalEventos, j.eventos.length);
  assertEquals(j.fonte, "drive (ao vivo)");
});

Deno.test("satisfação é anexada ao evento da mesma pasta", async () => {
  const j = await (await handleEventos(get(), deps())).json();
  const cursoA = j.eventos.find((e: { id: string }) => e.id === "curso-a-2026-04");
  assertEquals(cursoA.satisfacao.mediaGeral, 4.5); // curso-a tem satisfacao.xlsx
  const cursoB = j.eventos.find((e: { id: string }) => e.id === "curso-b-2026-05");
  assertEquals(cursoB.satisfacao, undefined); // curso-b não tem
});

Deno.test("manifesto com erro -> 502", async () => {
  // deno-lint-ignore require-await
  const res = await handleEventos(get(), deps({ fetchImpl: async (u: string) => u.includes("manifest") ? new Response(JSON.stringify({ ok: false }), { status: 200 }) : new Response("{}", { status: 200 }) }));
  assertEquals(res.status, 502);
});
