// Testes da função satisfacao (fetch mockado). Devolve o binário do xlsx.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { Buffer } from "node:buffer";
import { handleSatisfacao, type SatisfacaoDeps } from "./handler.ts";

const MANIFEST = {
  ok: true,
  files: [
    { path: "ciclo/turma 1 e 2/satisfacao.xlsx", id: "SAT1" },
    { path: "ciclo/turma 1 e 2/participantes.xlsx", id: "PART1" },
  ],
};
const CONTEUDO = Buffer.from([0x50, 0x4b, 0x03, 0x04]).toString("base64"); // "PK.." (zip/xlsx)

function deps(over: Partial<SatisfacaoDeps> = {}): SatisfacaoDeps {
  return {
    webappUrl: "https://as/exec",
    token: "TKN",
    // deno-lint-ignore require-await
    fetchImpl: async (url: string) => {
      if (url.includes("action=manifest")) return new Response(JSON.stringify(MANIFEST), { status: 200 });
      if (url.includes("action=file")) return new Response(JSON.stringify({ ok: true, base64: CONTEUDO }), { status: 200 });
      return new Response("{}", { status: 404 });
    },
    ...over,
  };
}

const get = (folder?: string, method = "GET") =>
  new Request("http://l/s" + (folder ? `?folder=${encodeURIComponent(folder)}` : ""), { method });

Deno.test("OPTIONS/CORS; POST -> 405; sem config -> 503; sem folder -> 400", async () => {
  assertEquals((await handleSatisfacao(get("x", "OPTIONS"), deps())).headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals((await handleSatisfacao(get("x", "POST"), deps())).status, 405);
  assertEquals((await handleSatisfacao(get("x"), deps({ webappUrl: "" }))).status, 503);
  assertEquals((await handleSatisfacao(get(), deps())).status, 400);
});

Deno.test("pasta sem satisfacao -> 404", async () => {
  const res = await handleSatisfacao(get("pasta-vazia"), deps());
  assertEquals(res.status, 404);
});

Deno.test("acha satisfacao -> 200 binário com Content-Type xlsx", async () => {
  const res = await handleSatisfacao(get("ciclo/turma 1 e 2"), deps());
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const buf = new Uint8Array(await res.arrayBuffer());
  assertEquals([buf[0], buf[1]], [0x50, 0x4b]); // assinatura PK do xlsx/zip
  assert(res.headers.get("Content-Disposition")!.includes("satisfacao.xlsx"));
});

Deno.test("manifesto com erro -> 502", async () => {
  // deno-lint-ignore require-await
  const res = await handleSatisfacao(get("x"), deps({ fetchImpl: async () => new Response(JSON.stringify({ ok: false }), { status: 200 }) }));
  assertEquals(res.status, 502);
});
