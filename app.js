"use strict";

const filtros = document.querySelectorAll("[data-filter]");
const familias = document.querySelectorAll("[data-family]");
const resultados = document.querySelector("#resultados");
const permiteMovimento = window.matchMedia("(prefers-reduced-motion: no-preference)");

const descobertas = {
  linguicas: { nome: "Linguiças", texto: "Da toscana ao queijo coalho com melaço, ideias para uma grelha cheia de sabor.", imagem: "assets/linguicas.webp", alt: "Estudo de apresentação das linguiças Nhac!" },
  salames: { nome: "Salames", texto: "Italiano, Milano, pepperoni e outras ideias para uma tábua que reúne a turma.", imagem: "assets/salames.webp", alt: "Estudo de apresentação dos salames Nhac!" },
  bacon: { nome: "Bacon", texto: "Em fatias ou cubos, o defumado pensado para dar mais sabor às receitas.", imagem: "assets/defumados.webp", alt: "Estudo de apresentação do bacon e outros defumados Nhac!" }
};
const botoesDescoberta = document.querySelectorAll(".discover-tab");
const imagemDescoberta = document.querySelector("#discover-image");
const nomeDescoberta = document.querySelector("#discover-name");
const textoDescoberta = document.querySelector("#discover-text");
for (const botao of botoesDescoberta) {
  botao.addEventListener("click", () => {
    const item = descobertas[botao.dataset.discover];
    for (const opcao of botoesDescoberta) opcao.setAttribute("aria-pressed", String(opcao === botao));
    imagemDescoberta.src = item.imagem;
    imagemDescoberta.alt = item.alt;
    nomeDescoberta.textContent = item.nome;
    textoDescoberta.textContent = item.texto;
    if (window.gsap && permiteMovimento.matches) {
      gsap.fromTo(".discover-frame", { opacity: 0.65, scale: 0.96, rotate: -2 }, { opacity: 1, scale: 1, rotate: 0, duration: 0.55, ease: "power3.out", overwrite: true });
      gsap.fromTo(".discover-description", { opacity: 0.5, y: 10 }, { opacity: 1, y: 0, duration: 0.4, overwrite: true });
    }
  });
}

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
        if (entry.target.matches(".motion-scene")) {
          gsap.timeline({ defaults: { ease: "power3.out" } })
            .from(".motion-disc", { scale: 0.55, opacity: 0, duration: 0.8 })
            .from(".motion-orbit", { scale: 0.7, opacity: 0, rotation: -25, duration: 0.9, stagger: 0.12 }, "<0.12")
            .from(".motion-mascot", { y: 45, scale: 0.85, opacity: 0, duration: 0.8 }, "<0.12")
            .from(".motion-label", { y: 18, scale: 0.85, opacity: 0, duration: 0.55, stagger: 0.12 }, "<0.18");
        } else {
          gsap.from(entry.target, { y: 28, opacity: 0, duration: 0.7, ease: "power2.out", clearProps: "transform,opacity" });
        }
      }
    }, { threshold: 0.12 });
    document.querySelectorAll(".discover-copy, .discover-visual, .motion-copy, .motion-scene, .destaques-intro, .sabor-destaque, .section-head, .family, .pairings article, .kit, .brand > div, .trade .two-col > div, .trade form").forEach((element) => observer.observe(element));
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
