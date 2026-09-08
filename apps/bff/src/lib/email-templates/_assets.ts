// Logo institucional embutido como data: URI (nunca imagem remota — evita
// pixel de tracking e ponto de falha de rede no cliente de e-mail).
//
// Fase 0: vazio. O ativo raster definitivo (PNG ~2x, fundo transparente) entra
// na revisão de design da Fase 1 (impeccable + frontend-design, ver
// docs/email-transacional.md e plano §3.2.1). Enquanto vazio, o layout usa um
// wordmark textual "APMCB" — sem <img src=""> quebrado.
export const LOGO_DATA_URI = "";
