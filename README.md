# Nhac! Charcutaria artesanal

Vitrine de apresentação do projeto Nhac!, de Uberlândia, MG. A página reúne a linha planejada, sugestões à mesa, apresentação da marca e briefing comercial para empórios e food service.

## Abrir e hospedar

Abra `index.html` no navegador. Para hospedagem estática, publique o conteúdo desta pasta mantendo os caminhos relativos de `estilo.css`, `app.js` e `assets/`. O site funciona sem compilação, dependências remotas ou banco de dados.

## Usar

Os botões do catálogo filtram as famílias. Cada cartão expande para mostrar os produtos planejados. O formulário gera um briefing local em texto simples. É possível copiá-lo ou baixá-lo como `briefing-nhac.txt`. Se o navegador bloquear a cópia automática, o site oferece seleção manual. Os dados do formulário não são enviados nem persistidos.

## Manutenção

Atualize textos, produtos e imagens em `index.html`, cores e composição em `estilo.css` e comportamentos em `app.js`. A cópia local do GSAP em `assets/gsap.min.js` anima a embalagem e os filtros quando a preferência de movimento permite. Imagens do plano de negócio são estudos de apresentação. Antes de acrescentar disponibilidade, canais comerciais ou datas de lançamento, confirme esses dados com os responsáveis pela marca.

## Publicação e conferência

Em hospedagem estática, envie somente os recursos públicos. Para gerar a pasta `dist` indicada na configuração do projeto, execute `.\preparar.ps1` no PowerShell. Publique seu conteúdo. Ajuste a URL absoluta de compartilhamento (`og:image`) se usar outro domínio.

As imagens de marca, embalagens e catálogo vêm do plano de negócio. A fonte Archivo Black inclui sua licença em `assets/archivo-ofl.txt`. O GSAP preserva o aviso de licença no arquivo distribuído.

A auditoria de navegador cobriu 320, 360, 390, 680, 768, 1024 e 1440 px, seleção e expansão das seis famílias, teclado, movimento reduzido, conteúdo copiado e baixado, âncoras, imagens e console. Para iniciar atendimento real, confirme o canal oficial com a marca e conecte-o à seção comercial.
