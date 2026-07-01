// Testes do login social Google (todos os caminhos, tokeninfo + DB injetados).
import { assert, assertEquals } from "jsr:@std/assert@1";
import type { AppUser } from "../login/handler.ts";
import type { GoogleClaims } from "../_shared/google.ts";
import { type GoogleDeps, handleGoogle } from "./handler.ts";

const CLIENT = "client-abc.apps.googleusercontent.com";
const NOW = 1_700_000_000_000;
const claimsValidas: GoogleClaims = {
  aud: CLIENT,
  iss: "https://accounts.google.com",
  exp: Math.floor(NOW / 1000) + 3600,
  email: "User@Egov.br",
  email_verified: true,
  name: "User Egov",
};
const user: AppUser = {
  email: "user@egov.br", name: "User Egov", password_hash: null,
  role: "admin", active: true, must_change_password: false, evento_id: null,
};

const post = (body: unknown, method = "POST") =>
  new Request("http://l/g", { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });

const deps = (over: Partial<GoogleDeps> = {}): GoogleDeps => ({
  clientId: CLIENT,
  now: NOW,
  // deno-lint-ignore require-await
  fetchTokenInfo: async () => claimsValidas,
  // deno-lint-ignore require-await
  getUser: async () => user,
  ...over,
});

const cred = () => ({ credential: "qualquer-id-token" });

Deno.test("OPTIONS -> CORS; GET -> 405", async () => {
  assertEquals((await handleGoogle(post({}, "OPTIONS"), deps())).headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals((await handleGoogle(post({}, "GET"), deps())).status, 405);
});

Deno.test("sem clientId -> 503", async () => {
  assertEquals((await handleGoogle(post(cred()), deps({ clientId: "" }))).status, 503);
});

Deno.test("sem credential -> 400", async () => {
  const res = await handleGoogle(post({}), deps());
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Token do Google ausente.");
});

Deno.test("tokeninfo nulo -> 401; tokeninfo lança -> 401", async () => {
  assertEquals((await handleGoogle(post(cred()), deps({ fetchTokenInfo: async () => null }))).status, 401);
  const throwing = deps({ fetchTokenInfo: () => { throw new Error("net"); } });
  assertEquals((await handleGoogle(post(cred()), throwing)).status, 401);
});

Deno.test("aud errada -> 401; issuer errado -> 401; expirado -> 401; email não verificado -> 401", async () => {
  const badAud = deps({ fetchTokenInfo: async () => ({ ...claimsValidas, aud: "outro" }) });
  assertEquals((await handleGoogle(post(cred()), badAud)).status, 401);
  const badIss = deps({ fetchTokenInfo: async () => ({ ...claimsValidas, iss: "evil.com" }) });
  assertEquals((await handleGoogle(post(cred()), badIss)).status, 401);
  const exp = deps({ fetchTokenInfo: async () => ({ ...claimsValidas, exp: Math.floor(NOW / 1000) - 10 }) });
  assertEquals((await handleGoogle(post(cred()), exp)).status, 401);
  const naoVerif = deps({ fetchTokenInfo: async () => ({ ...claimsValidas, email_verified: false }) });
  assertEquals((await handleGoogle(post(cred()), naoVerif)).status, 401);
});

Deno.test("fora da allowlist -> 403; erro de banco -> 503", async () => {
  assertEquals((await handleGoogle(post(cred()), deps({ getUser: async () => null }))).status, 403);
  const dbErr = deps({ getUser: () => { throw new Error("db"); } });
  assertEquals((await handleGoogle(post(cred()), dbErr)).status, 503);
});

Deno.test("sucesso -> 200 com contrato completo (email minúsculo)", async () => {
  const res = await handleGoogle(post(cred()), deps());
  assertEquals(res.status, 200);
  const j = await res.json();
  assertEquals(j.ok, true);
  assertEquals(j.email, "user@egov.br");
  assertEquals(j.name, "User Egov");
  assertEquals(j.role, "admin");
  assertEquals(j.eventoId, null);
});

Deno.test("palestrante: role e eventoId vêm da allowlist", async () => {
  const pal: AppUser = { ...user, role: "palestrante", evento_id: "gestao-da-inovacao" };
  const res = await handleGoogle(post(cred()), deps({ getUser: async () => pal }));
  const j = await res.json();
  assertEquals(j.role, "palestrante");
  assertEquals(j.eventoId, "gestao-da-inovacao");
});
