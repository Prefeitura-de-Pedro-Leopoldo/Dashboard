import { describe, it, expect } from "vitest";
import {
  unicosPorSecretaria,
  unicosPorSecretariaEvento,
  filtrarServidoresPorPeriodo,
} from "../assets/js/servidores.js";

// Mesma pessoa (mesmo email) inscrita em 2 eventos deve contar 1 vez.
const eventos = [
  {
    id: "e1",
    date: "2026-05-10",
    participantes: [
      { nome: "Ana", email: "ana@x.gov", secretaria: "Saúde", presente: true },
      { nome: "Bruno", email: "bruno@x.gov", secretaria: "Educação", presente: false },
      { nome: "Sem Sec", email: "sem@x.gov", secretaria: "", presente: true },
    ],
  },
  {
    id: "e2",
    date: "2026-05-12",
    participantes: [
      // Ana de novo (mesmo email) — não deve duplicar em Saúde.
      { nome: "Ana", email: "ana@x.gov", secretaria: "Saúde", presente: true },
      { nome: "Carla", email: "carla@x.gov", secretaria: "Saúde", presente: true },
    ],
  },
];

describe("unicosPorSecretaria (global)", () => {
  it("conta servidores únicos por secretaria, não inscrições", () => {
    const r = unicosPorSecretaria(eventos);
    const map = Object.fromEntries(r.map((x) => [x.nome, x.qtd]));
    expect(map["Saúde"]).toBe(2); // Ana (dedup) + Carla
    expect(map["Educação"]).toBe(1);
    expect(map["Não informado"]).toBe(1);
  });

  it("vem ordenado por qtd desc", () => {
    const r = unicosPorSecretaria(eventos);
    expect(r[0].qtd).toBeGreaterThanOrEqual(r[r.length - 1].qtd);
  });
});

describe("unicosPorSecretariaEvento (por evento)", () => {
  it("deduplica dentro do evento e usa Não informado", () => {
    const ev = {
      participantes: [
        { nome: "Ana", email: "ana@x.gov", secretaria: "Saúde" },
        { nome: "Ana", email: "ana@x.gov", secretaria: "Saúde" }, // duplicada
        { nome: "Zé", email: "", secretaria: "" },
      ],
    };
    const r = unicosPorSecretariaEvento(ev);
    const map = Object.fromEntries(r.map((x) => [x.nome, x.qtd]));
    expect(map["Saúde"]).toBe(1);
    expect(map["Não informado"]).toBe(1);
  });
});

describe("filtrarServidoresPorPeriodo", () => {
  const hoje = Date.now();
  const diasAtras = (d) => new Date(hoje - d * 864e5).toISOString().slice(0, 10);
  const servidores = [
    {
      nome: "Recente",
      eventos: [
        { date: diasAtras(5), presente: true },
        { date: diasAtras(200), presente: true },
      ],
      totalEventos: 2,
      totalPresentes: 2,
    },
    {
      nome: "Antigo",
      eventos: [{ date: diasAtras(200), presente: true }],
      totalEventos: 1,
      totalPresentes: 1,
    },
  ];

  it("'todos' não filtra", () => {
    expect(filtrarServidoresPorPeriodo(servidores, "todos")).toHaveLength(2);
  });

  it("'mensal' mantém só quem tem evento nos últimos 30 dias e recalcula totais", () => {
    const r = filtrarServidoresPorPeriodo(servidores, "mensal");
    expect(r).toHaveLength(1);
    expect(r[0].nome).toBe("Recente");
    expect(r[0].totalEventos).toBe(1); // só o evento recente entra
    expect(r[0].totalPresentes).toBe(1);
  });

  it("'semestral' inclui eventos de até 180 dias", () => {
    const r = filtrarServidoresPorPeriodo(servidores, "semestral");
    // 200 dias fica de fora; 5 dias entra → 'Recente' com 1 evento; 'Antigo' sai
    expect(r.map((s) => s.nome)).toEqual(["Recente"]);
  });
});
