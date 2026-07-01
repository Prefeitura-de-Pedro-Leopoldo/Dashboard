// Testes da Edge Function de login (deno test). Cobrem TODOS os caminhos com
// getUser injetado (sem banco real) e provam a PARIDADE com o código da Vercel:
// o hash abaixo foi gerado pelo lib/users.mjs (Node) e é conferido aqui (Deno).
//
// Rodar:  deno test supabase/functions/login/
import { assert, assertEquals } from "jsr:@std/assert@1";
import { verifyPassword } from "../_shared/auth.ts";
import { type AppUser, type GetUser, handleLogin } from "./handler.ts";

// Vetor de paridade: hash real produzido por hashPassword('SenhaTeste123!') no Node.
const SENHA = "SenhaTeste123!";
const HASH =
  "scrypt$489de8cfbf730ba21061979afa793434$0451850483e1ffa1c1a9380668c274965294482580f0c63b4045c098a8dc0b6dfed0c3bcd5d136195ff4da030b0a8a1748d809232ad1fbb3fd4d060b46c06270";

const post = (body: unknown) =>
  new Request("http://local/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const userBase: AppUser = {
  email: "Fulano@Exemplo.com",
  name: "Fulano de Tal",
  password_hash: HASH,
  role: "admin",
  active: true,
  must_change_password: false,
  evento_id: null,
};

// getUser fake: devolve um usuário, null, ou lança (erro de banco).
const fake = (u: AppUser | null | "throw"): GetUser =>
  // deno-lint-ignore require-await
  async (_email: string) => {
    if (u === "throw") throw new Error("db down");
    return u;
  };

const deps = (u: AppUser | null | "throw") => ({ getUser: fake(u), delayMs: 0 });

// ---- Paridade do scrypt (Node -> Deno) -------------------------------------
Deno.test("verifyPassword: paridade com hash gerado no Node", () => {
  assertEquals(verifyPassword(SENHA, HASH), true);
  assertEquals(verifyPassword("errada", HASH), false);
  assertEquals(verifyPassword(SENHA, "lixo"), false);
  assertEquals(verifyPassword(SENHA, null), false);
  assertEquals(verifyPassword(SENHA, "scrypt$semDerivado"), false);
});

// ---- Método / CORS ----------------------------------------------------------
Deno.test("OPTIONS retorna CORS (preflight)", async () => {
  const res = await handleLogin(new Request("http://local/login", { method: "OPTIONS" }), deps(null));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("GET não é permitido (405)", async () => {
  const res = await handleLogin(new Request("http://local/login", { method: "GET" }), deps(null));
  assertEquals(res.status, 405);
});

// ---- Validação de entrada ---------------------------------------------------
Deno.test("corpo vazio -> 400", async () => {
  const res = await handleLogin(post({}), deps(userBase));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Informe e-mail e senha.");
});

Deno.test("sem senha -> 400", async () => {
  const res = await handleLogin(post({ email: "a@b.com" }), deps(userBase));
  assertEquals(res.status, 400);
});

Deno.test("JSON inválido -> 400", async () => {
  const req = new Request("http://local/login", { method: "POST", body: "{ nao é json" });
  const res = await handleLogin(req, deps(userBase));
  assertEquals(res.status, 400);
});

// ---- Autenticação ----------------------------------------------------------
Deno.test("credenciais corretas -> 200 com contrato completo", async () => {
  const res = await handleLogin(post({ email: "fulano@exemplo.com", password: SENHA }), deps(userBase));
  assertEquals(res.status, 200);
  const j = await res.json();
  assertEquals(j.ok, true);
  assertEquals(j.email, "fulano@exemplo.com"); // sempre minúsculo
  assertEquals(j.name, "Fulano de Tal");
  assertEquals(j.role, "admin");
  assertEquals(j.eventoId, null);
  assertEquals(j.mustChangePassword, false);
});

Deno.test("senha errada -> 401", async () => {
  const res = await handleLogin(post({ email: "fulano@exemplo.com", password: "errada" }), deps(userBase));
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error, "Credenciais inválidas.");
});

Deno.test("usuário inexistente -> 401", async () => {
  const res = await handleLogin(post({ email: "x@y.com", password: SENHA }), deps(null));
  assertEquals(res.status, 401);
});

Deno.test("usuário inativo -> 401 (mesmo com senha certa)", async () => {
  const res = await handleLogin(post({ email: "fulano@exemplo.com", password: SENHA }), deps({ ...userBase, active: false }));
  assertEquals(res.status, 401);
});

Deno.test("erro de banco -> 503", async () => {
  const res = await handleLogin(post({ email: "fulano@exemplo.com", password: SENHA }), deps("throw"));
  assertEquals(res.status, 503);
});

// ---- Papel palestrante + defaults ------------------------------------------
Deno.test("palestrante: role e eventoId no retorno + mustChange", async () => {
  const pal: AppUser = { ...userBase, role: "palestrante", evento_id: "gestao-da-inovacao", must_change_password: true };
  const res = await handleLogin(post({ email: "fulano@exemplo.com", password: SENHA }), deps(pal));
  const j = await res.json();
  assertEquals(j.role, "palestrante");
  assertEquals(j.eventoId, "gestao-da-inovacao");
  assertEquals(j.mustChangePassword, true);
});

Deno.test("role nulo assume 'admin'; name nulo cai no prefixo do e-mail", async () => {
  const res = await handleLogin(post({ email: "SEM.NOME@x.com", password: SENHA }), deps({ ...userBase, role: null, name: null }));
  const j = await res.json();
  assertEquals(j.role, "admin");
  assertEquals(j.name, "sem.nome");
  assert(j.ok);
});
