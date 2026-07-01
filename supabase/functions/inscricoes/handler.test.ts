// Testes da função inscricoes (montagem de URL + proxy GET, fetch mockado).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildUpstreamUrl, handleInscricoes } from "./handler.ts";

const cfg = { webappUrl: "https://as/exec", token: "TKN" };
const q = (s: string) => new URLSearchParams(s);

Deno.test("URL: manifest", () => {
  assertEquals(buildUpstreamUrl(q("manifest=1"), cfg).url, "https://as/exec?action=manifest&token=TKN");
});

Deno.test("URL: inscritos por path (encoda barra e espaço)", () => {
  const r = buildUpstreamUrl(q("path=pl-por-todos/turma%201"), cfg);
  assert(r.url!.includes("action=inscritos"));
  assert(r.url!.includes("token=TKN"));
  assert(r.url!.includes("path=pl-por-todos%2Fturma%201"));
});

Deno.test("URL: presentes (kind=presentes)", () => {
  assert(buildUpstreamUrl(q("path=x&kind=presentes"), cfg).url!.includes("action=presentes"));
});

Deno.test("URL: sem path -> 400; sem config -> 503", () => {
  assertEquals(buildUpstreamUrl(q(""), cfg).status, 400);
  assertEquals(buildUpstreamUrl(q("manifest=1"), { webappUrl: "", token: "" }).status, 503);
});

Deno.test("handleInscricoes: GET encaminha; POST -> 405; OPTIONS -> CORS", async () => {
  const spy: { url?: string } = {};
  // deno-lint-ignore require-await
  const mock = async (url: string) => { spy.url = url; return new Response('{"ok":true,"sheets":[]}', { status: 200 }); };
  const res = await handleInscricoes(new Request("http://l/i?manifest=1", { method: "GET" }), cfg, mock);
  assertEquals(res.status, 200);
  assertEquals(spy.url, "https://as/exec?action=manifest&token=TKN");
  assertEquals((await handleInscricoes(new Request("http://l/i", { method: "POST" }), cfg, mock)).status, 405);
  assertEquals((await handleInscricoes(new Request("http://l/i", { method: "OPTIONS" }), cfg, mock)).headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("handleInscricoes: sem path devolve 400 (não chama upstream)", async () => {
  let chamou = false;
  // deno-lint-ignore require-await
  const mock = async () => { chamou = true; return new Response("{}"); };
  const res = await handleInscricoes(new Request("http://l/i", { method: "GET" }), cfg, mock);
  assertEquals(res.status, 400);
  assertEquals(chamou, false);
});
