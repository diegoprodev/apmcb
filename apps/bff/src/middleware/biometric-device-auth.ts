import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { supabase } from "../services/supabase";
import { canonicalDeviceRequest, isTimestampWithinSkew, verifyDeviceRequestSignature } from "../lib/biometric-device-auth";
import type { HonoVariables } from "../types/hono";

const CLOCK_SKEW_SECONDS = Number.parseInt(process.env.BIOMETRIC_BRIDGE_CLOCK_SKEW_SECONDS ?? "60", 10);

/**
 * Device-auth do bridge Windows real (Phase 1B) — substitui completamente
 * authMiddleware para as rotas bridge-facing (/api/biometric-bridge/*, exceto
 * /pair, que usa o código de pareamento em vez de uma chave já registrada).
 * Nunca monte esta rota sob o wildcard existente de authMiddleware
 * (/api/biometric/*) — ver nota de auditoria em
 * docs/superpowers/specs/2026-07-14-biometric-bridge-phase1b-windows-bridge-mvp-design.md.
 *
 * Sem usuário logado: authMiddleware exige cookie iron-session ou Bearer
 * JWT, nenhum dos dois existe no bridge. csrfMiddleware já é um no-op aqui
 * (só age quando há session.userId — ver middleware/csrf.ts), então não
 * precisa de exceção adicional.
 */
export const deviceAuthMiddleware: MiddlewareHandler<{ Variables: HonoVariables }> =
  async (c, next) => {
    const deviceId = c.req.header("x-bridge-device-id");
    const timestamp = c.req.header("x-bridge-timestamp");
    const nonce = c.req.header("x-bridge-nonce");
    const signature = c.req.header("x-bridge-signature");

    if (!deviceId || !timestamp || !nonce || !signature) {
      throw new HTTPException(401, { message: "Headers de device-auth ausentes" });
    }

    if (!isTimestampWithinSkew(timestamp, CLOCK_SKEW_SECONDS)) {
      throw new HTTPException(401, { message: "Timestamp fora da janela permitida" });
    }

    const { data: device, error: deviceErr } = await supabase
      .from("biometric_devices")
      .select("id, tenant_id, reserve_id, public_key, status, is_simulator, last_ip")
      .eq("id", deviceId)
      .maybeSingle();
    if (deviceErr) {
      c.get("log")?.error({ deviceId, error: deviceErr.message }, "biometric_bridge.device_auth.lookup_failure");
      throw new HTTPException(500, { message: "Não foi possível validar o dispositivo" });
    }
    if (!device || device.status !== "active" || device.is_simulator) {
      throw new HTTPException(401, { message: "Dispositivo não autorizado" });
    }

    // Corpo cru lido uma única vez — GET sem corpo vira string vazia, igual
    // ao contrato BODY_UTF8_OR_EMPTY da spec. Handlers downstream reusam
    // c.get("bridgeRawBody") em vez de ler o stream de novo (já consumido).
    const rawBody = c.req.method === "GET" || c.req.method === "HEAD" ? "" : await c.req.text();
    const url = new URL(c.req.url);
    const pathWithQuery = url.pathname + url.search;

    const canonicalInput = {
      method: c.req.method,
      pathWithQuery,
      bodyUtf8: rawBody,
      timestamp,
      nonce,
      deviceId,
    };

    if (!verifyDeviceRequestSignature(canonicalInput, device.public_key, signature)) {
      throw new HTTPException(401, { message: "Assinatura de request inválida" });
    }

    // Anti-replay: nonce só pode ser usado uma vez por device. Inserido
    // DEPOIS da assinatura validar — não registra estado para requests
    // inválidos.
    const { error: nonceErr } = await supabase
      .from("biometric_device_request_nonces")
      .insert({
        device_id: deviceId,
        nonce,
        request_hash: canonicalDeviceRequest(canonicalInput),
      });
    if (nonceErr) {
      if (nonceErr.code === "23505") {
        throw new HTTPException(401, { message: "Nonce já utilizado (replay detectado)" });
      }
      c.get("log")?.error({ deviceId, error: nonceErr.message }, "biometric_bridge.device_auth.nonce_insert_failure");
      throw new HTTPException(500, { message: "Não foi possível validar o request" });
    }

    c.set("bridgeDeviceId", device.id);
    c.set("bridgeTenantId", device.tenant_id);
    c.set("bridgeReserveId", device.reserve_id);
    c.set("bridgeRawBody", rawBody);

    // Fire-and-forget, e só quando o IP muda — achado de code review: escrever
    // em toda requisição (poll a cada ~1.5s por device em regime normal)
    // adicionava uma volta de rede síncrona à latência de CADA request
    // autenticado do bridge, mesmo sem mudança nenhuma. `device.last_ip` já
    // veio no SELECT acima, então dá pra comparar sem round-trip extra.
    const clientIp = c.req.header("cf-connecting-ip") ?? c.req.header("x-real-ip") ?? null;
    if (clientIp && clientIp !== device.last_ip) {
      void supabase.from("biometric_devices").update({ last_ip: clientIp }).eq("id", device.id)
        .then(({ error }) => {
          if (error) c.get("log")?.warn({ deviceId: device.id, error: error.message }, "biometric_bridge.device_auth.last_ip_update_failure");
        });
    }

    await next();
  };
