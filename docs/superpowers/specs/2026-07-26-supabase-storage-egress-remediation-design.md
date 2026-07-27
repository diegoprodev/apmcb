# APMCB — Spec: Correção de Supabase Storage Egress

**Data:** 2026-07-26
**Status:** v3 — aprovada; salvaguardas finais de precedência do body limit e CAS bruto incorporadas
**Branch de trabalho:** `fix/storage-egress`
**Objetivo de qualidade:** nota mínima 9,5/10 no code review final, sem achado CRÍTICO ou ALTO pendente

---

## 1. Contexto e evidência

O bucket privado `profile-photos` contém poucos megabytes, mas produziu gigabytes de egress. A auditoria anterior confirmou a seguinte cadeia:

1. Fotos JPEG/PNG originais de até 5 MB são armazenadas sem resize ou compressão.
2. A maior foto ativa observada possui 1.731.107 bytes.
3. O `DashboardLayout` gera uma signed URL em toda execução relevante do Server Component.
4. O Header recebe essa URL e solicita o objeto original para exibi-lo em 32×32 px.
5. `router.refresh()` e eventos SSE podem provocar novas execuções do layout.
6. Signed URLs geradas em instantes diferentes possuem tokens e cache keys diferentes.
7. Listagens assinam fotos antes de saber quais registros serão exibidos.
8. `/reserva/solicitacoes` assina fotos que não aparecem na interface.

Baseline registrado em uma worktree limpa:

- BFF: 172/172 testes passando.
- TypeScript BFF: sem erros.
- TypeScript web: sem erros.
- ESLint web: 0 erros e 88 warnings preexistentes.
- Nota da arquitetura de Storage antes da correção: 4,0/10.

Revisão v1 → v2:

1. O gate de lint passou a preservar o baseline de 88 warnings, sem ampliar esta correção para refactors não relacionados.
2. A troca de foto ganhou compare-and-swap sobre o `foto_url` lido.
3. A remoção do objeto antigo passou a exigir zero referências normalizadas.
4. O limite de 5 MiB passou a existir antes de `formData()`/alocação integral.
5. Resposta cujo `photoPath` diverge da query key não pode ser armazenada sob a versão antiga.
6. Código de delete de órfãos foi retirado integralmente desta entrega.
7. Queries privadas de foto serão removidas em logout ou troca de identidade.

Revisão v2 → v3:

1. As rotas de foto foram explicitamente excluídas da rejeição global de 2 MiB; o limite seletivo correto deve ser escolhido antes de qualquer middleware capaz de rejeitar o body.
2. O compare-and-swap passou a preservar separadamente a referência bruta lida do banco e o path normalizado usado em operações de Storage.

## 2. Objetivos

Esta implementação deve:

1. Garantir que todo novo avatar operacional seja WebP, tenha no máximo 512×512 px e no máximo 150 KB.
2. Corrigir orientação EXIF e validar o conteúdo real da imagem.
3. Centralizar processamento nativo no BFF/Bun, nunca no Edge Runtime.
4. Usar paths imutáveis que mudam somente quando a foto muda.
5. Retirar `createSignedUrl()` do ciclo do `DashboardLayout` e dos Server Components de perfil/listagem.
6. Resolver signed URLs no cliente, com uma única query TanStack por `(profileId, photoPath)`.
7. Impedir que `router.refresh()`, SSE, window focus ou re-render gerem nova URL enquanto a query estiver fresca.
8. Assinar somente fotos realmente montadas na interface.
9. Preservar bucket privado, isolamento por tenant e service role exclusivamente no BFF.
10. Fornecer dry-run seguro para fotos ativas e relatório separado de órfãos.
11. Produzir medição Network antes/depois sem estimativas inventadas.

## 3. Fora de escopo

- Tornar qualquer bucket privado público.
- Migrar Supabase Storage para R2.
- Comprar plano maior como correção.
- Reescrever a arquitetura SSE.
- Remover `router.refresh()` de fluxos operacionais.
- Refatorar integralmente `material-photos`.
- Apagar órfãos durante esta implementação.
- Alterar regras de negócio de cadastro, convite, TOTP, biometria ou custódia.
- Migrar o bucket legado `avatars` do Nexus.

## 4. Decisão de runtime e dependência

O processamento de imagem ficará em `apps/bff`, executado no Bun/VPS.

`sharp` será dependência direta do BFF, com versão fixada pelo lockfile do monorepo. A biblioteca já existe transitivamente por Next.js, mas dependência transitiva não constitui contrato para código de produção do BFF.

Razões:

- `sharp` valida e decodifica os bytes reais.
- Suporta auto-orientação EXIF, resize sem ampliação, WebP e limite de pixels.
- O Bun reconhece e instala `sharp` como dependência nativa suportada.
- O frontend usa Cloudflare/Edge, onde dependências nativas Node não são um contrato seguro.

Nenhum import de `sharp` poderá aparecer em `apps/web`.

## 5. Pipeline canônico de imagem

Será criada uma única função de domínio no BFF:

```ts
type ProcessedProfilePhoto = {
  bytes: Uint8Array;
  mime: "image/webp";
  width: number;
  height: number;
  size: number;
  quality: number;
};

async function processProfilePhoto(input: Uint8Array): Promise<ProcessedProfilePhoto>;
```

Contrato:

1. Rejeitar input vazio ou maior que 5 MiB.
2. Abrir com `sharp` usando limite de 40 milhões de pixels e sem desabilitar proteções nativas.
3. Aceitar somente metadata cujo formato real seja `jpeg`, `png` ou `webp`.
4. Rejeitar GIF, SVG, PDF, TIFF, HEIF, imagem animada e arquivo corrompido.
5. Aplicar auto-orientação EXIF.
6. Redimensionar com `fit: "inside"` e `withoutEnlargement: true`.
7. Tentar dimensão 512 com qualidades 80, 75, 70 e 65.
8. Preferir o primeiro resultado com até 100 KB.
9. Se nenhum ficar até 100 KB, aceitar o menor resultado de até 150 KB.
10. Se ainda exceder 150 KB, repetir em 448, 384, 320 e 256 px, qualidade 65.
11. Rejeitar com código `PROFILE_PHOTO_OUTPUT_TOO_LARGE` se nenhum resultado atingir 150 KB.
12. Remover metadata não necessária da saída.

O resultado sempre será WebP. O nome original e o MIME declarado pelo browser não participam da decisão de formato.

## 6. Persistência e compensação

### 6.1 Path

Toda foto nova usará:

```text
{profileId}/{uuid-v4}.webp
```

O cliente nunca escolhe o path. UUID será gerado no BFF com `crypto.randomUUID()`.

### 6.2 Serviço de troca

Será criada uma operação de domínio:

```ts
replaceProfilePhoto({
  actor,
  targetProfileId,
  rawBytes
})
```

Ordem obrigatória:

1. Autorizar ator e alvo.
2. Consultar o perfil escopado e guardar, sem sobrescrever nenhuma das duas variáveis:
   - `oldPhotoReferenceRaw`: valor exato de `foto_url` lido do banco, inclusive URL absoluta legada, usado exclusivamente na condição compare-and-swap;
   - `oldPhotoPathNormalized`: path canônico derivado de `oldPhotoReferenceRaw`, usado exclusivamente para Storage, contagem de referências e eventual remoção.
3. Processar a imagem.
4. Fazer upload do novo WebP com `upsert: false`, `contentType: image/webp` e cache-control de um ano, pois o path é imutável.
5. Atualizar `profiles.foto_url` por compare-and-swap, com filtros de `id`, `default_tenant_id` quando aplicável e exatamente `oldPhotoReferenceRaw`.
6. Para referência antiga nula, usar semântica `IS NULL`; para string, igualdade exata. O contrato é `foto_url IS NOT DISTINCT FROM :foto_url_lida`, não uma comparação que falhe silenciosamente com `NULL`.
7. Exigir confirmação de exatamente uma linha atualizada.
8. Se o banco falhar, remover o novo objeto como compensação e retornar erro.
9. Se o compare-and-swap afetar zero linhas, outra request alterou a versão: remover somente o novo objeto desta request, não remover o objeto antigo e retornar `409 PROFILE_PHOTO_CONFLICT`.
10. Após confirmação do banco, normalizar todas as referências não nulas de `profiles.foto_url` que possam apontar para `profile-photos`.
11. Remover o objeto anterior somente quando seu path for válido e a contagem normalizada de referências restantes for zero.
12. Se a consulta de referências falhar ou produzir resultado inconclusivo, não remover o antigo; registrar para relatório posterior.
13. Falha na remoção antiga não desfaz o perfil; gera log estruturado com `profileId`, path e request id, sem signed URL ou secret.

Nunca haverá remoção do objeto antigo antes da confirmação do banco ou quando outro perfil ainda apontar para o mesmo objeto. O fluxo normal também deixará de aceitar que clientes atribuam arbitrariamente paths antigos a `foto_url`; o path novo é sempre criado pelo BFF.

`oldPhotoReferenceRaw` nunca será substituído pelo resultado da normalização antes do CAS. Assim, por exemplo, uma referência legada absoluta como `https://.../storage/v1/object/public/profile-photos/abc/profile.jpg` é comparada no banco exatamente nessa forma, enquanto somente `oldPhotoPathNormalized = "abc/profile.jpg"` participa de operações no bucket e da recontagem.

### 6.3 Cadastro administrativo

O fluxo será invertido:

1. `POST /api/admin/militares` cria conta e perfil sem `foto_url`.
2. A resposta existente fornece `user_id`.
3. Se houver foto selecionada, o frontend chama `POST /api/profiles/:id/photo`.
4. A nova rota processa e grava em `{user_id}/{uuid}.webp`.
5. Se a foto falhar, o cadastro permanece válido e a UI informa explicitamente: “Militar cadastrado, mas a foto não foi salva”.
6. O frontend não repete o cadastro ao tratar essa falha parcial.

O endpoint legado `/api/admin/upload-photo` será desativado depois que o frontend novo estiver ativo. Durante a implantação coordenada:

1. BFF novo adiciona as novas rotas e coloca a rota antiga sob `PROFILE_PHOTO_LEGACY_UPLOAD_ENABLED`.
2. Enquanto a flag estiver ativa, a rota antiga ignora o path enviado pelo cliente, processa a imagem pelo pipeline canônico e cria `legacy-staged/{uuid}.webp` com `upsert: false`.
3. O único consumidor antigo recebe esse path processado e o grava no cadastro como já fazia.
4. A compatibilidade pode deixar um objeto processado órfão se o browser desaparecer entre upload e cadastro; o risco é limitado à curta janela de deploy, fica coberto pelo relatório de órfãos e não armazena mais originais grandes.
5. Frontend novo deixa de chamar a rota antiga e passa a criar o perfil antes da foto.
6. Depois da validação Network, a flag é desligada e `/api/admin/upload-photo` responde `410 Gone`.

O campo legado `foto_url` continuará aceito no JSON de cadastro somente enquanto `PROFILE_PHOTO_LEGACY_UPLOAD_ENABLED` estiver ativa e somente para paths `legacy-staged/{uuid}.webp` emitidos pela rota compatível. O frontend novo nunca o enviará. Com a flag desligada, qualquer `foto_url` no cadastro será rejeitado.

### 6.4 Upload próprio

`POST /api/profiles/me/photo` executará o mesmo serviço de troca, usando o `userId` da sessão como alvo.

O Route Handler Edge `apps/web/src/app/api/profiles/photo/route.ts` deixará de acessar Supabase Storage. Durante compatibilidade com bundles antigos, ele será um proxy fino para o BFF:

- encaminha multipart, cookie e proteção CSRF;
- não processa imagem;
- não possui service role;
- não cria signed URL;
- devolve o mesmo `photoPath` retornado pelo BFF.

O frontend novo chamará o BFF diretamente.

Para compatibilidade com o bundle antigo, `PATCH /api/profiles/me` aceitará `foto_url` apenas quando o valor enviado for exatamente igual ao valor atual já persistido — um no-op depois de o proxy/BFF ter concluído a troca. Qualquer tentativa de atribuir outro path diretamente será rejeitada. O frontend novo não enviará mais `foto_url` nesse PATCH.

### 6.5 Limite antes da alocação

O BFF possui hoje `bodyLimit({ maxSize: 2 * 1024 * 1024 })` global em `/api/*`. A implementação não aumentará esse limite para todas as rotas.

O wiring será alterado para selecionar uma única política de limite antes de qualquer rejeição:

- manter 2 MiB para qualquer API não relacionada a foto;
- excluir explicitamente `POST /api/profiles/me/photo`, `POST /api/profiles/:id/photo` e a rota legada temporária da regra global de 2 MiB;
- aplicar nessas rotas o limite máximo de request de `5 MiB + 64 KiB` antes de `c.req.formData()` e antes de qualquer middleware que possa rejeitar a request pelo tamanho;
- depois do parser, exigir `file.size <= 5 MiB`;
- rejeitar `Content-Length` conhecido acima do limite sem ler o body;
- manter a proteção streaming do `bodyLimit` para requests sem `Content-Length` ou com transfer encoding;
- somente então converter o arquivo aceito em `Uint8Array`.

Os 64 KiB adicionais existem exclusivamente para boundary e headers multipart; o arquivo continua limitado a 5 MiB. `limitInputPixels` do `sharp` é a barreira seguinte contra arquivo comprimido pequeno que expande excessivamente ao decodificar.

É inválido registrar primeiro um `bodyLimit` global de 2 MiB e tentar sobrescrevê-lo depois na rota de foto: nesse arranjo, o middleware global rejeitaria uploads legítimos antes que a exceção pudesse executar.

## 7. Endpoint autorizado de signed URL

Contrato:

```http
GET /api/profiles/:profileId/photo-url
```

Resposta com foto:

```json
{
  "profileId": "uuid",
  "photoPath": "uuid/uuid.webp",
  "signedUrl": "https://.../object/sign/profile-photos/...",
  "expiresAt": "ISO-8601"
}
```

Resposta sem foto:

```json
{
  "profileId": "uuid",
  "photoPath": null,
  "signedUrl": null,
  "expiresAt": null
}
```

Regras:

1. O endpoint recebe somente `profileId`; nunca recebe bucket ou path arbitrário.
2. O BFF deriva `foto_url` do banco.
3. O próprio usuário pode consultar a própria foto.
4. `admin_global`, `admin_reserva` e `armeiro` podem consultar alvo no mesmo `default_tenant_id`.
5. `usuario`, `auditor` e `superadmin` não consultam fotos operacionais de terceiros.
6. Alvo inexistente ou fora do tenant retorna 404 genérico.
7. URL pública legada de `profile-photos` é normalizada para path.
8. Path contendo `..`, barra invertida, query, fragmento, prefixo de outro bucket ou URL de outro host é rejeitado.
9. O endpoint cria signed URL com TTL de 3.600 segundos.
10. `Cache-Control: private, no-store` será usado na resposta JSON: o cache intencional é o QueryClient da sessão, não proxies compartilhados.

## 8. Componente e cache client-side

Será criada uma infraestrutura única:

```ts
profilePhotoQueryKey(profileId, photoPath)
useProfilePhotoUrl(profileId, photoPath)
<ProfileAvatar profileId photoPath name ... />
```

Configuração por query:

```ts
{
  queryKey: ["profile-photo-url", profileId, photoPath],
  enabled: Boolean(profileId && photoPath),
  staleTime: 50 * 60 * 1000,
  gcTime: 60 * 60 * 1000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchOnMount: true,
  refetchInterval: false,
  retry: 1
}
```

Propriedades:

- A key inclui o path e muda naturalmente quando a foto muda.
- Header, perfil, listas e dialogs compartilham a mesma entrada.
- `router.refresh()` pode substituir props, mas não recria o `QueryClient` do browser.
- Se `photoPath` permanecer igual, a query fresca não faz novo request.
- Depois de 50 minutos, uma montagem futura pode renovar a signed URL antes/depois de sua expiração; uma instância continuamente montada conserva a imagem já carregada e não cria polling.
- Se o path mudar, outra key é criada e a nova foto é carregada.
- Enquanto carrega ou falha, `AvatarFallback` exibe iniciais sem layout shift.
- O componente não usa Blob, objectURL, preload ou signed URL vinda do servidor.

Consistência entre query key e banco:

1. O BFF continua derivando o path do banco; o cliente nunca escolhe o objeto assinado.
2. O query function compara `response.photoPath` com o `photoPath` usado na key.
3. Se forem iguais, a resposta é armazenada normalmente.
4. Se forem diferentes, a signed URL nunca é retornada como sucesso sob a key antiga.
5. A resposta canônica é semeada com `queryClient.setQueryData()` sob `["profile-photo-url", profileId, response.photoPath]`.
6. A query antiga lança `PROFILE_PHOTO_VERSION_MISMATCH`, sem signed URL em seus dados.
7. O hook dispara no máximo um `router.refresh()` para sincronizar os dados estáveis do perfil.
8. Quando o Server Component fornecer o novo path, a key correta já contém a resposta; não há segunda assinatura.
9. Se o refresh continuar devolvendo o path antigo, o componente permanece no fallback e não entra em loop.

Higiene de sessão:

- `AuthListener` terá acesso ao `QueryClient` e acompanhará o `session.user.id`.
- Em `SIGNED_OUT`, removerá todas as queries com prefixo `["profile-photo-url"]` antes do hard redirect.
- Se o usuário autenticado mudar de A para B na mesma árvore cliente, removerá o mesmo prefixo antes de consumir dados de B.
- `TOKEN_REFRESHED` do mesmo usuário não limpa a cache.
- Hard navigation continua sendo defesa adicional, pois recria o `QueryClient`.

Após upload:

1. A API devolve o novo `photoPath`, sem signed URL.
2. O estado que fornece o path é atualizado.
3. A nova query key resolve a foto.
4. A key antiga pode ser removida do QueryClient, mas nunca será invalidada para refetch.

## 9. Migração dos consumidores

Todos os acessos operacionais a `profile-photos` devem convergir:

| Fluxo | Mudança |
|---|---|
| `DashboardLayout` | Remover `resolvePhotoUrl`; fornecer `userId` e `photoPath`; remover preload |
| `AppShell`/`Header` | Trocar `userPhoto` por dados estáveis e `ProfileAvatar` |
| `/perfil` | Remover assinatura server-side e compartilhar query do Header |
| `/efetivo/perfil` | Usar a mesma infraestrutura |
| `/admin/usuarios` | Remover `resolvePhotosInBulk`; manter path bruto; montar avatar apenas em `displayed` |
| `/reserva/militares` | Remover resolução em massa; manter path bruto; montar somente registros visíveis |
| `/reserva/solicitacoes` | Remover seleção/resolução de `foto_url` se não houver consumidor |
| `/reserva/saidas` | Remover mapa de signed URLs; preservar agrupamento e deduplicar pelo QueryClient |
| Dialogs/lightboxes | Reutilizar a mesma query key do avatar já visível |
| Relatórios operacionais | Passar `profileId` e path ao componente quando exibirem foto |
| Desarmamento | Substituir URL bruta pelo componente autorizado |

`resolvePhotoUrl()` continuará existindo somente para `material-photos` durante esta fase, com nome/API que torne explícito que não é a infraestrutura de foto de perfil.

Critério estático: depois da migração, nenhuma chamada server-side a `createSignedUrl()` ou `resolvePhotoUrl()` poderá existir no fluxo de `profile-photos`, exceto rota BFF autorizada, scripts administrativos e testes.

## 10. Migração das fotos ativas

Script:

```text
apps/bff/scripts/migrate-active-profile-photos.ts
```

Modo padrão e obrigatório: dry-run.

Dry-run:

1. Busca perfis com `foto_url` não nulo.
2. Normaliza apenas referências válidas de `profile-photos`.
3. Lista `profileId`, path atual, MIME, bytes e metadata.
4. Baixa o objeto atual.
5. Processa em memória com o pipeline canônico.
6. Exibe dimensão, qualidade, tamanho e path novo proposto.
7. Não faz upload, update ou delete.
8. Emite resumo JSON reutilizável no relatório.

Modo real exige simultaneamente:

```text
--apply --confirmation=APPLY-ACTIVE-PROFILE-PHOTO-MIGRATION
```

Mesmo com o modo implementado, esta tarefa não o executará sem aprovação explícita após apresentação do dry-run.

No modo real, cada perfil usa o mesmo compare-and-swap do serviço online e segue upload → update confirmado → recontagem normalizada de referências → delete antigo somente com contagem zero. Conflito remove apenas o objeto novo daquela tentativa. Falha ou referência compartilhada preserva o objeto antigo e registra resultado individual. O script nunca processa objetos sem referência ativa.

## 11. Relatório de órfãos

Script:

```text
apps/bff/scripts/report-profile-photo-orphans.ts
```

Saída:

- path;
- bytes;
- MIME;
- `created_at`;
- profile que referencia, quando houver;
- classificação `active` ou `orphan`.

O script é incondicionalmente read-only: não aceitará flag de delete e não conterá chamada a `storage.remove()`, DELETE HTTP ou update de banco. Uma futura limpeza terá spec, script e revisão próprios.

## 12. Segurança

Controles obrigatórios:

1. `profile-photos` permanece privado.
2. Service role apenas em `apps/bff` e scripts administrativos.
3. Todas as rotas passam por `authMiddleware`.
4. Upload administrativo passa por `roleGuard("admin_global", "admin_reserva", "armeiro")`.
5. Escritas e leituras de terceiros usam `default_tenant_id = c.get("tenantId")`.
6. Usuário comum só altera/assina a própria foto.
7. `superadmin` não recebe acesso transversal a dados operacionais.
8. Nenhum path de Storage fornecido pelo cliente é confiado.
9. Upload usa UUID e `upsert: false`.
10. Erros não expõem service key, signed URL, stack trace ou existência de alvo fora do tenant.
11. Limite de request antes do parser, limite de arquivo e limite de pixels protegem memória/CPU em camadas.
12. A rota de upload permanece sob rate limiting e CSRF já existentes.
13. Remoção antiga exige compare-and-swap bem-sucedido e contagem normalizada de referências igual a zero.
14. Signed URLs em memória são removidas em logout ou troca de identidade.

## 13. Tratamento de erros

| Código | HTTP | Significado |
|---|---:|---|
| `PROFILE_PHOTO_REQUIRED` | 400 | multipart sem arquivo |
| `PROFILE_PHOTO_INPUT_TOO_LARGE` | 413 | input acima de 5 MiB |
| `PROFILE_PHOTO_INVALID` | 400 | bytes corrompidos ou formato não permitido |
| `PROFILE_PHOTO_PIXELS_EXCEEDED` | 400 | limite de pixels excedido |
| `PROFILE_PHOTO_OUTPUT_TOO_LARGE` | 422 | não foi possível atingir 150 KB |
| `PROFILE_PHOTO_TARGET_NOT_FOUND` | 404 | alvo ausente ou fora do tenant |
| `PROFILE_PHOTO_FORBIDDEN` | 403 | papel não pode operar o alvo |
| `PROFILE_PHOTO_CONFLICT` | 409 | outra request alterou a foto desde a leitura |
| `PROFILE_PHOTO_VERSION_MISMATCH` | — | erro tipado no cliente: resposta pertence a path mais novo que a query key |
| `PROFILE_PHOTO_STORAGE_FAILED` | 502 | upload/delete obrigatório falhou |
| `PROFILE_PHOTO_UPDATE_FAILED` | 500 | banco falhou; novo objeto compensado |

Falha ao apagar objeto antigo depois do update retorna sucesso com warning apenas no log do servidor; não envia detalhes internos ao cliente.

## 14. Estratégia de testes e spec harness

Toda produção será escrita por TDD.

### 14.1 Processamento real

Testes gerarão imagens em memória por `sharp`, sem fixture binária gigante no Git:

- JPEG entre 3 e 5 MB;
- PNG entre 3 e 5 MB;
- EXIF com rotação;
- imagem menor que 512 px;
- imagem com ruído de alta entropia;
- bytes falsos com `Content-Type: image/jpeg`;
- GIF/SVG e imagem acima do limite de pixels.

Asserções:

- saída WebP decodificável;
- largura e altura até 512;
- tamanho até 150 KB;
- imagem pequena não ampliada;
- orientação corrigida;
- inválidos rejeitados.

### 14.2 Transação

O serviço receberá adaptadores explícitos de Storage e perfil para testar comportamento real de domínio sem acessar produção.

Cenários:

- sucesso na primeira foto;
- troca com remoção antiga posterior ao update;
- upload falha;
- update falha e remove novo;
- compare-and-swap afeta zero linhas, remove somente o novo e retorna conflito;
- duas trocas concorrentes não sofrem lost update nem removem a vencedora;
- delete antigo falha sem perder nova foto;
- path antigo inválido nunca é removido.
- path antigo compartilhado por dois perfis nunca é removido;
- referência equivalente em forma absoluta e relativa conta como o mesmo objeto;
- falha na recontagem de referências preserva o objeto antigo.
- referência antiga absoluta legada usa o valor bruto exato no CAS e o path normalizado apenas para Storage;
- CAS nunca recebe `oldPhotoPathNormalized` no lugar de `oldPhotoReferenceRaw`.

### 14.3 Limites de request

Testes comportamentais sobre o wiring real do Hono devem comprovar:

- multipart com arquivo bruto maior que 2 MiB e menor que 5 MiB é aceito por cada rota de foto;
- a mesma classe de body em uma rota comum continua rejeitada em 2 MiB;
- arquivo maior que 5 MiB é rejeitado na rota de foto;
- o middleware de 2 MiB não executa antes da política específica de foto.

### 14.4 Autorização

- self-service permitido;
- staff no mesmo tenant permitido;
- usuário comum tentando terceiro recebe 403;
- staff cross-tenant recebe 404;
- superadmin tentando alvo operacional recebe 403;
- path legado válido é normalizado;
- path traversal e host externo são rejeitados.

### 14.5 Cache React

Com `QueryClient` real:

- dois `ProfileAvatar` com mesma key produzem um request;
- re-render com as mesmas props produz zero requests adicionais;
- desmontar/remontar dentro de `gcTime` reutiliza a query;
- simulação de `router.refresh()` com mesmo path preserva a URL;
- evento SSE seguido de props equivalentes preserva a URL;
- `/perfil` e Header compartilham a mesma query;
- path novo produz exatamente uma nova resolução;
- window focus/reconnect não refaz a query.
- resposta com path B para key A não armazena a URL sob A;
- mismatch semeia a key B e dispara no máximo um refresh;
- logout remove todas as queries de foto;
- troca de user id remove as queries; token refresh do mesmo usuário preserva.

### 14.6 Guardas estáticas

Um harness do BFF lerá os arquivos reais e falhará se:

- `DashboardLayout` importar `resolvePhotoUrl`;
- o layout contiver preload para avatar assinado;
- páginas de perfil/listagem chamarem resolvedores server-side de `profile-photos`;
- solicitações selecionarem/resolverem `foto_url` sem renderização;
- frontend importar `sharp`;
- service role aparecer em `apps/web`;
- `/api/admin/upload-photo` continuar operacional depois da fase de retirada.
- script de órfãos conter qualquer chamada destrutiva.

Guardas estáticas complementam, mas não substituem, testes comportamentais.

### 14.7 Network harness

Playwright autenticado registrará separadamente:

- requests de assinatura `/storage/v1/object/sign/profile-photos`;
- GETs reais do objeto;
- bytes transferidos;
- URLs únicas;
- cache/service worker;
- status e `CF-Cache-Status`, quando presente.

Cenários:

1. carga inicial do dashboard;
2. dez `router.refresh()` com path inalterado;
3. dez eventos equivalentes a refresh SSE;
4. navegação por cinco páginas;
5. abertura de `/perfil`;
6. troca de foto em fixture controlada.

O harness será executado primeiro contra o baseline e depois contra a implementação. Se o ambiente não permitir autenticação comparável, o relatório declarará a limitação e não atribuirá redução percentual.

## 15. Critérios de aceitação

- [ ] JPEG/PNG bruto de 3–5 MB resulta em WebP válido.
- [ ] Toda saída tem no máximo 512×512 e 150 KB.
- [ ] EXIF é corrigido e imagens menores não são ampliadas.
- [ ] MIME real é validado.
- [ ] Paths novos são `{profileId}/{uuid}.webp`.
- [ ] DashboardLayout não cria signed URL.
- [ ] Header não recebe signed URL do servidor.
- [ ] `router.refresh()` com path igual não refaz a query fresca.
- [ ] SSE não causa novo GET apenas por atualizar dados operacionais.
- [ ] Header e perfil compartilham cache.
- [ ] Solicitações não resolvem foto não renderizada.
- [ ] Listagens montam resolutores somente para registros visíveis.
- [ ] Bucket permanece privado.
- [ ] Cross-tenant e signed-URL oracle são bloqueados.
- [ ] Troca falha sem deixar perfil sem foto.
- [ ] Duas trocas concorrentes usam compare-and-swap e não removem a foto vencedora.
- [ ] Objeto antigo compartilhado nunca é removido enquanto houver outra referência normalizada.
- [ ] Request acima do limite é rejeitado antes de `formData()`/alocação integral.
- [ ] Arquivo bruto >2 MiB e <5 MiB é aceito em rota de foto, enquanto rota comum permanece limitada a 2 MiB.
- [ ] `oldPhotoReferenceRaw` é usado sem normalização no CAS e `oldPhotoPathNormalized` somente em Storage/contagem/remoção.
- [ ] Mismatch entre query key e banco não associa signed URL ao path antigo.
- [ ] Logout e troca de identidade limpam queries `profile-photo-url`.
- [ ] Dry-run lista todas as fotos ativas sem escrever.
- [ ] Órfãos são somente reportados.
- [ ] Testes existentes e novos passam.
- [ ] Typecheck e build passam.
- [ ] Playwright visual e Network são executados.
- [ ] ESLint possui zero erros.
- [ ] Nenhum warning novo é introduzido.
- [ ] Arquivos alterados por esta implementação não possuem novos warnings.
- [ ] A quantidade global de warnings permanece menor ou igual ao baseline de 88.
- [ ] Warnings preexistentes fora do escopo não são corrigidos nesta tarefa.
- [ ] Code review por subagente atinge pelo menos 9,5/10.
- [ ] Nenhum achado CRÍTICO ou ALTO permanece aberto.

## 16. Implantação e rollback

Ordem:

1. Implantar BFF aditivo com novas rotas e pipeline.
2. Executar smoke de upload e assinatura.
3. Implantar frontend usando `ProfileAvatar`.
4. Executar Network harness.
5. Desativar `/api/admin/upload-photo` legado no BFF.
6. Executar novamente testes e Network.
7. Executar dry-run de migração.
8. Solicitar aprovação separada antes do `--apply`.

Rollback:

- Reverter o frontend não exige reverter o bucket ou banco.
- BFF mantém contratos antigos durante a janela coordenada.
- Paths novos continuam válidos mesmo se a UI anterior for restaurada.
- Nenhuma migration SQL é necessária para o núcleo da correção.
- Fotos antigas só são removidas depois que o novo path estiver confirmado no perfil.

## 17. Code review e nota

Antes de qualquer commit com produção:

1. Executar diff completo, testes, typecheck, lint, build e Playwright aplicável.
2. Invocar subagente `code-reviewer` com o mandato integral do `CLAUDE.md`.
3. Exigir classificação por severidade, cenário concreto e arquivo/linha.
4. Corrigir todo achado CRÍTICO e ALTO.
5. Reexecutar testes afetados e suíte integral.
6. Repetir code review até não haver CRÍTICO/ALTO.
7. Calcular nota final por segurança, correção, testes, performance, regressão e clareza.
8. Não aceitar nota inferior a 9,5/10.

O relatório final seguirá as 14 seções exigidas pelo proprietário e incluirá comandos, contagens, falhas, diff e números reais de Network.
