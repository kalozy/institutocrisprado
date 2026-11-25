# Instituto Cris Prado: site + cursos + painel de leads

Site completo para **institutocrisprado.com.br**, pronto para GitHub + Vercel.

| Endereço | Página |
|---|---|
| `/` | Instituto Cris Prado (página principal) |
| `/start-lips/` | Start Lips |
| `/transforme-faces-com-fios/` | Transforme Faces com Fios |
| `/admin/` | Painel de leads e configurações (todas as páginas) |

As três páginas usam a mesma paleta do Instituto (creme, marrom e dourado). Todas têm Meta Pixel + API de Conversões.

## Estrutura

```
public/                         tudo que vai para o navegador
  index.html                    Instituto (imagens e fontes extraídas para assets/)
  assets/cp-track.js            rastreamento Meta compartilhado (Pixel + CAPI)
  assets/cp-course.js           formulário, oferta, vídeo e checkout dos cursos
  start-lips/                   página + fotos/vídeo do curso
  transforme-faces-com-fios/    página + fotos/vídeo do curso
  admin/                        painel
api/                            funções do Vercel (Node)
  settings.js  lead.js  event.js  webhook.js  admin.js
lib/                            código compartilhado das funções (banco, Meta, login)
scripts/dev-server.mjs          servidor para testar no computador
vercel.json                     configuração do Vercel (pasta public, redirecionamentos, cache)
```

## Publicar

### 1. GitHub
Crie um repositório e suba o conteúdo desta pasta (o `.gitignore` já deixa `node_modules` e `.env` de fora).

### 2. Vercel
1. **Add New > Project**, importe o repositório. Não precisa mudar nada: o `vercel.json` já define a pasta `public` e as funções em `api/`.
2. **Storage > Create Database > Neon (Postgres)** e conecte ao projeto. O Vercel cria a variável `DATABASE_URL` sozinho. As tabelas são criadas no primeiro acesso.
3. **Settings > Environment Variables**, adicione:
   - `ADMIN_PASSWORD`: senha do painel
   - `APP_SECRET`: texto aleatório com 32 caracteres ou mais (no terminal: `openssl rand -hex 32`). Ele assina o login e a chave do webhook; se trocar, o login cai e a URL do webhook muda.
4. Faça um novo deploy (**Deployments > Redeploy**) para as variáveis valerem.

### 3. Domínio
**Settings > Domains**, adicione `institutocrisprado.com.br` e `www.institutocrisprado.com.br` e crie no DNS os registros que o Vercel mostrar. Deixe o `www` redirecionando para o domínio sem www (as páginas usam esse como endereço oficial).

### 4. Painel (`/admin/`)
Em **Configurações**:
- **Meta Ads** (vale para o site todo): ID do Pixel, token da API de Conversões, código de teste → **Testar conexão com a Meta** → apague o código de teste.
- **Cada curso**: link do checkout, preço, preço riscado e parcelamento (opcionais), faixa da campanha, fim da condição (contagem regressiva real), mensagem do WhatsApp e, se quiser, um Pixel próprio.
- **Webhook**: copie a URL de cada curso e cadastre no checkout (evento de pagamento aprovado).

Links antigos `/cursos`, `/sobre`, `/procedimentos` e `/contato` redirecionam para as seções da página principal.

## Rastreamento Meta

Cada evento sai do navegador (Pixel) e do servidor (CAPI) com o mesmo `event_id`, e a Meta remove as duplicatas. A CAPI recebe IP, navegador, `fbp`, `fbc`, `external_id` e, depois do formulário, e-mail, telefone e nome com hash SHA-256. A origem da campanha (UTMs e `fbclid`) vale para o site todo: quem chega por um anúncio da página principal e vai para um curso leva a campanha até o checkout.

| Evento | Página | Quando |
|---|---|---|
| PageView | todas | Ao abrir |
| ViewContent | cursos | Ao abrir (com valor) |
| Scroll25 / 50 / 75 / 90 | todas | Rolagem |
| TimeOnPage30 / 60 / 120 | todas | Tempo com a aba visível |
| **Contact** | principal | Clique no WhatsApp, telefone ou e-mail (`channel`, `position`) |
| ClickCourse | principal | Clique em um curso |
| ClickInstagram | principal | Clique no Instagram |
| ViewOffer | cursos | Oferta aparece na tela |
| ClickCTA | cursos | Clique em qualquer botão (`position`) |
| VideoSoundOn / Video50 / VideoComplete | cursos | Vídeo com som |
| FAQOpen | cursos | Pergunta aberta |
| FormStart | cursos | Primeiro campo do formulário |
| **Lead** | cursos | Primeiro envio completo do formulário |
| **InitiateCheckout** | cursos | Ida para o checkout |
| Purchase | cursos | Webhook de pagamento (opcional; desligado por padrão) |

Para campanhas da página principal, otimize por **Contact**.

## Testar no computador

```bash
npm install
DATABASE_URL="postgres://..." ADMIN_PASSWORD="teste" APP_SECRET="um-texto-aleatorio-bem-longo" npm run dev
# abre em http://localhost:3000
```
Pode usar a mesma `DATABASE_URL` do Neon (copie em Storage no Vercel).

## Novo curso

1. Copie a pasta de um curso em `public/` com o novo nome e troque textos, fotos e vídeo (os caminhos usam `/nome-da-pasta/assets/...`).
2. No fim do `index.html` do curso, troque `product`, `productName` e `category` em `window.CP_PAGE`.
3. Em `lib/products.js`, adicione o curso com o mesmo `id`.
4. Adicione um link para ele em `public/index.html` (seção de cursos e rodapé).

## Antes de publicar

- **Transforme Faces com Fios**: o vídeo não diz formato, carga horária, prazo de acesso, certificado nem bônus, e a página não promete nada disso. O preço vem do painel.
- **Start Lips**: confirmar prazo de acesso, certificado e materiais extras; as fotos reais dos 3 modelos entram em `data-photo` (veja o comentário no HTML).
- As fotos da Cris nas páginas de curso foram recortadas dos vídeos; troque por fotos oficiais se tiver.
- Completar a política de privacidade (no rodapé dos cursos) com razão social, CNPJ e contato.
