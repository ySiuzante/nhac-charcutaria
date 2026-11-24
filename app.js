"use strict";

const filtros = document.querySelectorAll("[data-filter]");
const familias = document.querySelectorAll("[data-family]");
const resultados = document.querySelector("#resultados");
const permiteMovimento = window.matchMedia("(prefers-reduced-motion: no-preference)");

const menu = document.querySelector(".mobile-menu");
const telaMobile = window.matchMedia("(max-width: 680px)");
menu.open = !telaMobile.matches;
telaMobile.addEventListener("change", (event) => { menu.open = !event.matches; });
menu.addEventListener("click", (event) => {
  if (telaMobile.matches && event.target.closest("nav a")) menu.open = false;
});
menu.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menu.open) {
    menu.open = false;
    menu.querySelector("summary").focus();
  }
});

if (window.gsap) {
  gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
    const entrada = gsap.timeline({ defaults: { ease: "power3.out" } });
    entrada.from(".hero-copy > *", { y: 24, opacity: 0, duration: 0.7, stagger: 0.1 })
      .from(".hero-pic", { y: 32, rotation: 0, opacity: 0, duration: 0.85 }, "<0.15");

    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        gsap.from(entry.target, { y: 28, opacity: 0, duration: 0.7, ease: "power2.out", clearProps: "transform,opacity" });
      }
    }, { threshold: 0.12 });
    document.querySelectorAll(".destaques-intro, .sabor-destaque, .section-head, .family, .pairings article, .kit, .brand > div, .trade .two-col > div, .trade form").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
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
