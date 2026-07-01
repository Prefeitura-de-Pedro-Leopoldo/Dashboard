// Testes da troca de senha (todos os caminhos, DB injetado). O hash abaixo foi
// gerado pelo lib/users.mjs (Node) — paridade com a Vercel.
import { assert, assertEquals } from "jsr:@std/assert@1";
import type { AppUser } from "../login/handler.ts";
import { handleChangePassword } from "./handler.ts";

const SENHA = "SenhaTeste123!";
const HASH =
  "scrypt$489de8cfbf730ba21061979afa793434$0451850483e1ffa1c1a9380668c274965294482580f0c63b4045c098a8dc0b6dfed0c3bcd5d136195ff4da030b0a8a1748d809232ad1fbb3fd4d060b46c06270";

const user: AppUser = {
  email: "Fulano@Exemplo.com", name: "Fulano", password_hash: HASH,
  role: "admin", active: true, must_change_password: true, evento_id: null,
};

const post = (body: unknown, method = "POST") =>
  new Request("http://l/cp", { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });

function makeDeps(u: AppUser | null | "throw", opts: { setFails?: boolean } = {}) {
  const saved: { email?: string; hash?: string } = {};
  return {
    saved,
    deps: {
      // deno-lint-ignore require-await
      getUser: async () => { if (u === "throw") throw new Error("db"); return u; },
      // deno-lint-ignore require-await
      setPassword: async (email: string, hash: string) => { if (opts.setFails) throw new Error("write"); saved.email = email; saved.hash = hash; },
      delayMs: 0,
    },
  };
}

Deno.test("OPTIONS -> CORS; GET -> 405", async () => {
  const { deps } = makeDeps(user);
  assertEquals((await handleChangePassword(post({}, "OPTIONS"), deps)).headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals((await handleChangePassword(post({}, "GET"), deps)).status, 405);
});

Deno.test("campos faltando -> 400", async () => {
  const { deps } = makeDeps(user);
  assertEquals((await handleChangePassword(post({ email: "a@b.com" }), deps)).status, 400);
});

Deno.test("nova senha fraca -> 400", async () => {
  const { deps } = makeDeps(user);
  const res = await handleChangePassword(post({ email: "fulano@exemplo.com", currentPassword: SENHA, newPassword: "fraca" }), deps);
  assertEquals(res.status, 400);
});

Deno.test("nova senha igual à atual -> 400", async () => {
  const { deps } = makeDeps(user);
  const res = await handleChangePassword(post({ email: "fulano@exemplo.com", currentPassword: SENHA, newPassword: SENHA }), deps);
  assertEquals(res.status, 400);
  assert((await res.json()).error.includes("diferente"));
});

Deno.test("senha atual incorreta -> 401", async () => {
  const { deps } = makeDeps(user);
  const res = await handleChangePassword(post({ email: "fulano@exemplo.com", currentPassword: "errada", newPassword: "NovaSenha123!" }), deps);
  assertEquals(res.status, 401);
});

Deno.test("erro de banco (getUser) -> 503", async () => {
  const { deps } = makeDeps("throw");
  const res = await handleChangePassword(post({ email: "a@b.com", currentPassword: SENHA, newPassword: "NovaSenha123!" }), deps);
  assertEquals(res.status, 503);
});

Deno.test("falha ao gravar -> 500", async () => {
  const { deps } = makeDeps(user, { setFails: true });
  const res = await handleChangePassword(post({ email: "fulano@exemplo.com", currentPassword: SENHA, newPassword: "NovaSenha123!" }), deps);
  assertEquals(res.status, 500);
});

Deno.test("sucesso -> 200, grava o hash e devolve email/name", async () => {
  const { deps, saved } = makeDeps(user);
  const res = await handleChangePassword(post({ email: "fulano@exemplo.com", currentPassword: SENHA, newPassword: "NovaSenha123!" }), deps);
  assertEquals(res.status, 200);
  const j = await res.json();
  assertEquals(j.ok, true);
  assertEquals(j.email, "fulano@exemplo.com");
  assertEquals(j.name, "Fulano");
  assert(saved.hash!.startsWith("scrypt$")); // novo hash gravado
  assert(saved.hash !== HASH);
});
