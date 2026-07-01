// Testes do proxy genérico do Apps Script (deno test). Cobrem todos os caminhos
// com fetch mockado — nenhuma rede real. Mesmo contrato dos proxies /api Vercel.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { type FetchLike, handleGetProxy, handlePostProxy } from "./appscript.ts";

const post = (body: unknown, method = "POST") =>
  new Request("http://local/fn", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });

// fetch mock: devolve status+texto fixos e registra a última chamada.
function mockFetch(status: number, text: string, spy?: { url?: string; init?: RequestInit }): FetchLike {
  // deno-lint-ignore require-await
  return async (url: string, init?: RequestInit) => {
    if (spy) { spy.url = url; spy.init = init; }
    return new Response(text, { status });
  };
}

Deno.test("POST: repassa e devolve o JSON do upstream (200)", async () => {
  const spy: { url?: string; init?: RequestInit } = {};
  const res = await handlePostProxy(post({ action: "x" }), { url: "https://as/exec" }, mockFetch(200, '{"ok":true,"v":1}', spy));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).v, 1);
  assertEquals(spy.url, "https://as/exec");
});

Deno.test("POST: injeta o token no corpo (não confia no client)", async () => {
  const spy: { url?: string; init?: RequestInit } = {};
  await handlePostProxy(post({ action: "x", token: "FALSO" }), { url: "https://as/exec", token: "REAL" }, mockFetch(200, "{}", spy));
  const sent = JSON.parse(String(spy.init!.body));
  assertEquals(sent.token, "REAL");
});

Deno.test("POST: sem token configurado, não injeta", async () => {
  const spy: { url?: string; init?: RequestInit } = {};
  await handlePostProxy(post({ a: 1 }), { url: "https://as/exec" }, mockFetch(200, "{}", spy));
  const sent = JSON.parse(String(spy.init!.body));
  assertEquals(sent.token, undefined);
});

Deno.test("POST: valida action quando allowedActions definido", async () => {
  const cfg = { url: "https://as/exec", token: "t", allowedActions: new Set(["config-get", "config-save"]) };
  const bad = await handlePostProxy(post({ action: "hackear" }), cfg, mockFetch(200, "{}"));
  assertEquals(bad.status, 400);
  const ok = await handlePostProxy(post({ action: "config-get" }), cfg, mockFetch(200, '{"ok":true}'));
  assertEquals(ok.status, 200);
});

Deno.test("POST: método errado -> 405; OPTIONS -> CORS", async () => {
  assertEquals((await handlePostProxy(post({}, "GET"), { url: "u" }, mockFetch(200, "{}"))).status, 405);
  const pf = await handlePostProxy(post({}, "OPTIONS"), { url: "u" }, mockFetch(200, "{}"));
  assertEquals(pf.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("POST: sem url -> 503; corpo inválido -> 400", async () => {
  assertEquals((await handlePostProxy(post({}), { url: "" }, mockFetch(200, "{}"))).status, 503);
  const req = new Request("http://local/fn", { method: "POST", body: "{ quebrado" });
  assertEquals((await handlePostProxy(req, { url: "u" }, mockFetch(200, "{}"))).status, 400);
});

Deno.test("POST: upstream não-JSON -> 502; upstream não-ok -> 502", async () => {
  assertEquals((await handlePostProxy(post({}), { url: "u" }, mockFetch(200, "<html>erro"))).status, 502);
  assertEquals((await handlePostProxy(post({}), { url: "u" }, mockFetch(500, '{"ok":false}'))).status, 502);
});

Deno.test("POST: fetch lança -> 500", async () => {
  // deno-lint-ignore require-await
  const throwing: FetchLike = async () => { throw new Error("rede caiu"); };
  const res = await handlePostProxy(post({}), { url: "u" }, throwing);
  assertEquals(res.status, 500);
});

Deno.test("GET: repassa e devolve JSON; método errado -> 405", async () => {
  const spy: { url?: string; init?: RequestInit } = {};
  const res = await handleGetProxy(post({}, "GET"), "https://as/exec?action=manifest", mockFetch(200, '{"ok":true,"files":[]}', spy));
  assertEquals(res.status, 200);
  assert(Array.isArray((await res.json()).files));
  assertEquals(spy.url, "https://as/exec?action=manifest");
  assertEquals((await handleGetProxy(post({}, "POST"), "u", mockFetch(200, "{}"))).status, 405);
});
