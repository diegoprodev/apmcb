# Storage egress — evidência antes/depois

Comparação autenticada do mesmo fluxo de navegação:

| Métrica | Antes | Depois | Variação |
|---|---:|---:|---:|
| GETs de objetos `profile-photos` | 2 | 1 | -50,0% |
| URLs de Storage únicas | 2 | 1 | -50,0% |
| `Content-Length` declarado | 740.609 B | 494.766 B | -33,2% |

O frontend novo fez uma resolução autorizada no BFF e reutilizou a mesma query
durante as dez navegações equivalentes e as cinco páginas. O baseline não expõe
as assinaturas server-side ao browser, por isso `resolverRequests=0` antes não
significa ausência de assinatura.

Esta comparação foi executada antes de qualquer migração `--apply`. O dry-run
real encontrou 2.513.085 B em quatro fotos ativas e propôs 95.726 B em WebP
(-96,2%). Esse número é projeção do pipeline sobre os objetos atuais e não foi
misturado com a medição Network observada.

Limitação declarada: os bytes comparáveis acima vêm do header HTTP
`Content-Length`; o harness não os apresenta como `encodedDataLength` do CDP.
Os cliques client-side exercitam reexecuções de navegação/RSC com `photoPath`
estável, mas não são apresentados como dez eventos SSE reais.
