# Expedição VD e VET — CD Barueri

App para controlar a expedição da Venda Direta (VD) e do Vet Criador (VET), com o painel de reserva de stages e docas.

## Publicar na Vercel

1. Crie um repositório no GitHub (ex.: `expedicao-vd-vet`) e suba **todo o conteúdo desta pasta**.
2. Na Vercel: **Add New → Project →** escolha o repositório → **Deploy** (não precisa mudar nada; o `vercel.json` já configura).
3. No projeto da Vercel, aba **Storage**:
   - **Upstash Redis** (Marketplace) → criar/conectar ao projeto. Cria as variáveis `KV_REST_API_URL` / `KV_REST_API_TOKEN` (ou `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — o app aceita as duas).
     Use um banco **novo** ou um prefixo separado; não compartilhe com outro app.
   - **Blob** → criar e conectar. Cria a variável `BLOB_READ_WRITE_TOKEN` (fotos do espelho/romaneio).
4. Aba **Settings → Environment Variables**, adicione:
   - `ADMIN_PASSWORD` = a senha do administrador (obrigatório trocar).
   - `ADMIN_USER` = login do administrador (opcional; padrão `admin`).
5. **Deployments → Redeploy** para aplicar as variáveis.

No primeiro acesso o app já carrega: 26 docas e 58 stages ativos (3 e 14 inativas), os 115 colaboradores e os 5 tipos de erro padrão.

## Perfis

| Perfil | O que faz |
|---|---|
| Operação (sem login) | Reserva stage/doca, registra chegada e saída, preenche separador, conferente, expedidor, erros e fotos |
| Líder | Tudo da operação + envia arquivo do dia, edita dados da rota (motorista, peso…), muda status, libera stage manualmente |
| Coordenador | Tudo do líder + cadastros (stages/docas, colaboradores, erros, alertas) e excluir rota |
| Administrador | Tudo + usuários e edição de rota já expedida |

Os usuários de líder e coordenador são criados em **Cadastros → Usuários** (somente admin).

## Regras principais

- Cada carga é identificada por **data + rota + transportadora + motorista**.
- Reenviar o arquivo do mesmo dia: rotas iguais são ignoradas, novas são acrescentadas e, se o motorista ou o peso mudou, a prévia pergunta se atualiza, cria nova ou ignora.
- Stage/doca fica **ocupado** enquanto houver rota vinculada não expedida; **libera sozinho** quando a última rota for expedida. Uma rota ocupa um único stage/doca (se reservar em outro, o app pergunta se quer mover).
- **Pré-reserva**: rota de dia futuro cujo arquivo ainda não subiu. Ao enviar o arquivo daquela data, vincula sozinha por rota + transportadora.
- VD: ao registrar a chegada numa doca, ela aparece como **Em carregamento** e libera na saída.
- Saída exige ao menos uma foto do espelho (VD) ou romaneio (VET) assinado.

## Testar no computador (opcional)

```
npm install
npm run dev
```
Abre em http://localhost:3000 com banco local de teste (arquivo `.local-db.json`). Admin: `admin` / `premierpet`.
