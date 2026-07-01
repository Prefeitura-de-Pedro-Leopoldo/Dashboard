// Testes de certificado. Paridade BYTE-IDÊNTICA com o Node: o código abaixo foi
// gerado pelo api/certificado.js (secret default) e o Deno reproduz/valida igual.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { makeCode, verifyCode } from "../_shared/certificado.ts";
import { handleCertificado } from "./handler.ts";

const SECRET = "egov-pl-cert-dev-secret-DEFINA-CERT_SECRET";
const NODE_CODE =
  "eyJuIjoiQW5hIFNvdXphIiwiYyI6IkN1cnNvIFgiLCJoIjoiOCIsImQiOiIwMS8wNy8yMDI2In0.U6COqi5x7xJZPi2pzFAr1n7s";

Deno.test("paridade: código do Node valida no Deno", () => {
  const v = verifyCode(NODE_CODE, SECRET);
  assertEquals(v.valido, true);
  assertEquals(v.cert!.nome, "Ana Souza");
  assertEquals(v.cert!.curso, "Curso X");
  assertEquals(v.cert!.carga, "8");
});

Deno.test("Deno assina IGUAL ao Node (byte a byte) e valida", () => {
  const code = makeCode({ nome: "Ana Souza", curso: "Curso X", carga: "8", data: "01/07/2026" }, SECRET);
  assertEquals(code, NODE_CODE);
  assertEquals(verifyCode(code, SECRET).valido, true);
});

Deno.test("adulteração e formatos inválidos -> inválido", () => {
  const bad = NODE_CODE.slice(0, -1) + (NODE_CODE.slice(-1) === "A" ? "B" : "A");
  assertEquals(verifyCode(bad, SECRET).valido, false);
  assertEquals(verifyCode("sem-ponto", SECRET).valido, false);
  assertEquals(verifyCode("", SECRET).valido, false);
});

Deno.test("segredo diferente não valida (não forjável)", () => {
  assertEquals(verifyCode(NODE_CODE, "outro-segredo").valido, false);
});

const post = (body: unknown) => new Request("http://l/c", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

Deno.test("POST assina em lote; lista vazia -> 400; acima de 5000 -> 413", async () => {
  const res = await handleCertificado(post({ certs: [{ nome: "A", curso: "C", carga: "8", data: "01/01" }] }), SECRET);
  assertEquals(res.status, 200);
  const j = await res.json();
  assertEquals(j.items.length, 1);
  assert(String(j.items[0].codigo).includes("."));
  assertEquals((await handleCertificado(post({ certs: [] }), SECRET)).status, 400);
  const big = { certs: new Array(5001).fill({ nome: "A", curso: "C", carga: "8", data: "d" }) };
  assertEquals((await handleCertificado(post(big), SECRET)).status, 413);
});

Deno.test("GET valida por código; sem código -> 400; OPTIONS/405", async () => {
  const ok = await handleCertificado(new Request("http://l/c?codigo=" + encodeURIComponent(NODE_CODE), { method: "GET" }), SECRET);
  assertEquals((await ok.json()).valido, true);
  assertEquals((await handleCertificado(new Request("http://l/c", { method: "GET" }), SECRET)).status, 400);
  assertEquals((await handleCertificado(new Request("http://l/c", { method: "OPTIONS" }), SECRET)).headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals((await handleCertificado(new Request("http://l/c", { method: "PUT" }), SECRET)).status, 405);
});
