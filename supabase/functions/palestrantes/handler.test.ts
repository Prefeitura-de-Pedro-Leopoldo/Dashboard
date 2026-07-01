// Testes de palestrantes: proxy + gatilho de provisionamento (fetch e provision
// mockados). Garante que o acesso só é provisionado no cadastro bem-sucedido.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { type ProvisionArgs, handlePalestrantes } from "./handler.ts";

const post = (body: unknown, method = "POST") =>
  new Request("http://l/p", { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });

function setup(upstream: { ok: boolean; json: unknown }) {
  const calls: { proxied?: unknown; provisioned?: ProvisionArgs } = {};
  const fetchImpl = // deno-lint-ignore require-await
    async (_u: string, init?: RequestInit) => {
      calls.proxied = JSON.parse(String(init!.body));
      return new Response(JSON.stringify(upstream.json), { status: upstream.ok ? 200 : 500 });
    };
  // deno-lint-ignore require-await
  const provision = async (args: ProvisionArgs) => { calls.provisioned = args; };
  return { calls, deps: { url: "https://as/exec", token: "TKN", loginUrl: "https://site/", fetchImpl, provision } };
}

Deno.test("OPTIONS -> CORS; GET -> 405; sem config -> 503; ação inválida -> 400", async () => {
  const { deps } = setup({ ok: true, json: { ok: true } });
  assertEquals((await handlePalestrantes(post({}, "OPTIONS"), deps)).headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals((await handlePalestrantes(post({}, "GET"), deps)).status, 405);
  assertEquals((await handlePalestrantes(post({ action: "list" }), { ...deps, url: "" })).status, 503);
  assertEquals((await handlePalestrantes(post({ action: "hackear" }), deps)).status, 400);
});

Deno.test("injeta token; list NÃO provisiona", async () => {
  const { calls, deps } = setup({ ok: true, json: { ok: true, palestrantes: [] } });
  const res = await handlePalestrantes(post({ action: "list", token: "FALSO" }), deps);
  assertEquals(res.status, 200);
  assertEquals((calls.proxied as { token: string }).token, "TKN");
  assertEquals(calls.provisioned, undefined); // list não provisiona
});

Deno.test("create bem-sucedido -> provisiona com email/nome/cursoId", async () => {
  const { calls, deps } = setup({ ok: true, json: { ok: true, palestrante: { id: "1" } } });
  await handlePalestrantes(post({ action: "create", email: "a@b.com", nome: "Fulano", cursoId: "gestao" }), deps);
  assertEquals(calls.provisioned?.email, "a@b.com");
  assertEquals(calls.provisioned?.name, "Fulano");
  assertEquals(calls.provisioned?.eventoId, "gestao");
  assertEquals(calls.provisioned?.loginUrl, "https://site/");
});

Deno.test("create com upstream ok:false -> NÃO provisiona", async () => {
  const { calls, deps } = setup({ ok: true, json: { ok: false, error: "x" } });
  await handlePalestrantes(post({ action: "create", email: "a@b.com", nome: "F" }), deps);
  assertEquals(calls.provisioned, undefined);
});

Deno.test("create sem email -> NÃO provisiona", async () => {
  const { calls, deps } = setup({ ok: true, json: { ok: true } });
  await handlePalestrantes(post({ action: "create", nome: "F" }), deps);
  assertEquals(calls.provisioned, undefined);
});

Deno.test("provision lançando não quebra a resposta do cadastro", async () => {
  const { deps } = setup({ ok: true, json: { ok: true } });
  // deno-lint-ignore require-await
  const res = await handlePalestrantes(post({ action: "create", email: "a@b.com", nome: "F" }), { ...deps, provision: async () => { throw new Error("provision falhou"); } });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).ok, true);
});

Deno.test("invite-submit também provisiona (cursoId vazio -> eventoId null)", async () => {
  const { calls, deps } = setup({ ok: true, json: { ok: true } });
  await handlePalestrantes(post({ action: "invite-submit", email: "a@b.com", nome: "F", cursoTitulo: "Curso X" }), deps);
  assertEquals(calls.provisioned?.email, "a@b.com");
  assertEquals(calls.provisioned?.eventoId, null);
});
