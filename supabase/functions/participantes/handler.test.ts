// Testes da função participantes (deps injetados: fetch, parse, buildEvento, meta).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleParticipantes, type ParticipantesDeps } from "./handler.ts";

const MANIFEST = {
  ok: true,
  files: [
    { path: "gestao-inovacao-presencial-2026-06/participantes.xlsx", id: "FILE1" },
    { path: "outro-evento/participantes.xlsx", id: "FILE2" },
  ],
};

function mockFetch(fileHasData = true) {
  // deno-lint-ignore require-await
  return async (url: string) => {
    if (url.includes("action=manifest")) return new Response(JSON.stringify(MANIFEST), { status: 200 });
    if (url.includes("action=file")) return new Response(JSON.stringify({ ok: true, base64: fileHasData ? "AAA" : "" }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
}

function baseDeps(over: Partial<ParticipantesDeps> = {}): ParticipantesDeps {
  return {
    webappUrl: "https://as/exec",
    token: "TKN",
    metaUrl: "https://site/meta.json",
    fetchImpl: mockFetch(),
    parseWorkbook: () => [{ nome: "Ana", secretaria: "Saúde", presente: true }],
    buildEvento: (rel, _meta, parts) => ({ id: "ev", fonte: rel, total: (parts as unknown[]).length }),
    // deno-lint-ignore require-await
    loadMeta: async () => new Map([["gestao-inovacao-presencial-2026-06/participantes.xlsx", { id: "gestao-da-inovacao" }]]),
    ...over,
  };
}

const get = (folder?: string, method = "GET") =>
  new Request("http://l/participantes" + (folder ? `?folder=${encodeURIComponent(folder)}` : ""), { method });

Deno.test("OPTIONS -> CORS; POST -> 405; sem config -> 503; sem folder -> 400", async () => {
  assertEquals((await handleParticipantes(get("x", "OPTIONS"), baseDeps())).headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals((await handleParticipantes(get("x", "POST"), baseDeps())).status, 405);
  assertEquals((await handleParticipantes(get("x"), baseDeps({ webappUrl: "" }))).status, 503);
  assertEquals((await handleParticipantes(get(), baseDeps())).status, 400);
});

Deno.test("pasta sem participantes.xlsx -> found:false", async () => {
  const res = await handleParticipantes(get("pasta-inexistente"), baseDeps());
  const j = await res.json();
  assertEquals(j.found, false);
  assertEquals(j.hasData, false);
});

Deno.test("arquivo vazio (parse retorna []) -> found:true, hasData:false", async () => {
  const res = await handleParticipantes(get("gestao-inovacao-presencial-2026-06"), baseDeps({ parseWorkbook: () => [] }));
  const j = await res.json();
  assertEquals(j.found, true);
  assertEquals(j.hasData, false);
});

Deno.test("sucesso -> monta o evento com o parser (buildEvento) e devolve", async () => {
  let usouRel = "";
  const res = await handleParticipantes(get("gestao-inovacao-presencial-2026-06"), baseDeps({
    buildEvento: (rel, _m, parts) => { usouRel = rel; return { id: "gestao-da-inovacao", total: (parts as unknown[]).length }; },
  }));
  assertEquals(res.status, 200);
  const j = await res.json();
  assertEquals(j.hasData, true);
  assertEquals(j.evento.total, 1);
  assertEquals(usouRel, "gestao-inovacao-presencial-2026-06/participantes.xlsx");
});

Deno.test("manifesto com erro -> 502", async () => {
  // deno-lint-ignore require-await
  const badFetch = async () => new Response(JSON.stringify({ ok: false, error: "x" }), { status: 200 });
  const res = await handleParticipantes(get("x"), baseDeps({ fetchImpl: badFetch }));
  assertEquals(res.status, 502);
});
