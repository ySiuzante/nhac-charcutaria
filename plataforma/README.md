# Nhac! Plataforma — fundação local

Este diretório contém o início da plataforma. O servidor atende somente no próprio computador, usando Node.js 24 ou superior e SQLite nativo. A vitrine institucional existente permanece separada.

## Testar a loja e o painel

Na pasta `plataforma`, execute `npm run demo` com Node.js 24 ou superior. Abra `http://127.0.0.1:3000` ou, em um GitHub Codespace, a aba **Ports** e o endereço da porta privada 3000.

O terminal mostra as senhas aleatórias de `admin@nhac.example` e `cliente@nhac.example` e a chave do autenticador para a conta MAIN. Cadastre a chave como TOTP de seis dígitos. Para alternar entre os perfis, use janelas com sessões separadas.

O cliente pode buscar produtos, alternar entre varejo e atacado, editar o carrinho e registrar pedidos. O MAIN pode consultar os pedidos, alterar status, restituir estoque ao cancelar um pedido e gerenciar o acesso ao atacado. Os preços, formatos e estoques da demonstração são exemplos. O cadastro público depende do serviço de e-mail e pedidos de teste são registrados sem cobrança.

Cada execução cria um banco temporário separado do banco de desenvolvimento, com credenciais novas. Encerre pelo terminal para finalizar a sessão. A demonstração destina-se a localhost ou a uma porta privada no Codespaces.

## Configurar a chave

No PowerShell, gere uma chave aleatória para criptografar os segredos do aplicativo autenticador:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Guarde o resultado fora do projeto, em um gerenciador de segredos seguro. Defina-o na sessão atual:

```powershell
$env:NHAC_TOTP_KEY = 'COLE_A_CHAVE_DE_64_CARACTERES'
cd 'C:\Users\Encomendas\Documents\agente-01\nhac\plataforma'
```

Use a mesma chave sempre. Sem ela, a autenticação dos administradores deixa de funcionar. Não compartilhe a chave e não a salve em arquivos versionados.

## Criar o primeiro administrador

```powershell
node setup-main.mjs
```

Informe nome, e-mail e senha de pelo menos 12 caracteres. Cadastre a chave exibida em um aplicativo autenticador e confirme com o código de seis dígitos. A senha e o código não são exibidos durante a digitação. A configuração inicial só permite criar um MAIN e não pode ser acessada pelo navegador.

O código utilizado na configuração não pode ser reutilizado. Aguarde o próximo código do autenticador antes de entrar.

## Executar e testar

```powershell
node server.mjs
node --test tests/*.test.mjs
```

Abra `http://127.0.0.1:3000`. O banco é criado em `data/nhac.sqlite`, que deve permanecer fora do Git. `NHAC_DB_PATH` e `PORT` são opcionais para desenvolvimento.

## Limites da fase

O servidor impede execução com `NODE_ENV=production` e escuta apenas em localhost. Login de MAIN usa TOTP, senhas com scrypt e sessões com cookies HttpOnly/SameSite. A proteção do último MAIN é aplicada por gatilhos do banco. A API verifica origem e CSRF nas operações de sessão.

Cadastro público depende de e-mail transacional e está desabilitado. Convites, recuperação de acesso, permissões granulares, edição comercial do catálogo, lotes, endereços, frete, pagamentos, financeiro, logística, fiscal, backups operacionais e hospedagem segura são etapas pendentes da operação comercial.

Os dados locais e a chave de criptografia precisam ser protegidos e copiados em segurança por quem opera o ambiente. O mecanismo de limitação de tentativas é em memória e perde seu histórico ao reiniciar. SQLite e o servidor de desenvolvimento não oferecem as garantias necessárias para produção.
