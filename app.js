"use strict";

const filtros = document.querySelectorAll("[data-filter]");
const familias = document.querySelectorAll("[data-family]");
const resultados = document.querySelector("#resultados");
const permiteMovimento = window.matchMedia("(prefers-reduced-motion: no-preference)");

if (window.gsap) {
  gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
    gsap.from(".hero-pic", { y: 10, opacity: 0.6, duration: 0.45, ease: "power2.out" });
  });
}

for (const filtro of filtros) {
  filtro.addEventListener("click", () => {
    const selecionada = filtro.dataset.filter;
    for (const botao of filtros) {
      botao.setAttribute("aria-pressed", String(botao === filtro));
    }
    for (const familia of familias) {
      familia.hidden = selecionada !== "todas" && familia.dataset.family !== selecionada;
    }
    if (window.gsap && permiteMovimento.matches) {
      const visiveis = [...familias].filter((familia) => !familia.hidden);
      gsap.fromTo(visiveis, { y: 5, opacity: 0.8 }, { y: 0, opacity: 1, duration: 0.2, overwrite: true });
    }
    resultados.textContent = selecionada === "todas"
      ? "Todas as famílias estão visíveis."
      : "Família exibida: " + filtro.textContent + ".";
  });
}

const formulario = document.querySelector("#brief");
const retorno = document.querySelector("#retorno");
const manual = document.querySelector("#manual");
const textoManual = document.querySelector("#texto-manual");

function montarBriefing() {
  const dados = new FormData(formulario);
  const interesses = dados.getAll("familia").join(", ");
  return [
    "Nhac! — Briefing comercial",
    "Estabelecimento: " + (dados.get("estabelecimento").trim() || "A definir"),
    "Canal: " + dados.get("canal"),
    "Famílias de interesse: " + (interesses || "A definir"),
    "Necessidades: " + (dados.get("necessidade").trim() || "A definir")
  ].join("\n");
}

formulario.addEventListener("submit", (evento) => evento.preventDefault());
formulario.addEventListener("input", () => {
  retorno.textContent = "";
  manual.hidden = true;
});

document.querySelector("#copiar").addEventListener("click", async () => {
  const texto = montarBriefing();
  try {
    await navigator.clipboard.writeText(texto);
    manual.hidden = true;
    retorno.textContent = "Briefing copiado.";
  } catch {
    manual.hidden = false;
    textoManual.value = texto;
    textoManual.focus();
    textoManual.select();
    retorno.textContent = "Texto selecionado. Use a opção Copiar do seu dispositivo.";
  }
});

document.querySelector("#baixar").addEventListener("click", () => {
  const arquivo = new Blob(["\uFEFF", montarBriefing()], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(arquivo);
  const link = document.createElement("a");
  link.href = url;
  link.download = "briefing-nhac.txt";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  retorno.textContent = "Download solicitado ao navegador.";
});
