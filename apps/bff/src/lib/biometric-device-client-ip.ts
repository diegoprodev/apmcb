import { getAuditClientIp, type AuditIpLogger } from "./audit-client-ip.ts";

type LastIpUpdateResult = {
  error: { message: string } | null;
};

type ScheduleLastIpUpdateParams = {
  request: Request;
  currentIp: string | null;
  deviceId: string;
  log: AuditIpLogger;
  update(clientIp: string): PromiseLike<LastIpUpdateResult> | LastIpUpdateResult;
};

const UPDATE_FAILURE_MESSAGE = "biometric_bridge.device_auth.last_ip_update_failure";

/**
 * Schedules the best-effort device IP update without joining it to the
 * authenticated request's critical path.
 */
export function scheduleBiometricDeviceLastIpUpdate({
  request,
  currentIp,
  deviceId,
  log,
  update,
}: ScheduleLastIpUpdateParams): void {
  const clientIp = getAuditClientIp(request, log);

  if (!clientIp || clientIp === currentIp) {
    return;
  }

  void Promise.resolve()
    .then(() => update(clientIp))
    .then(({ error }) => {
      if (error) {
        log.warn({ deviceId, error: error.message }, UPDATE_FAILURE_MESSAGE);
      }
    })
    .catch((error: unknown) => {
      log.warn({
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      }, UPDATE_FAILURE_MESSAGE);
    });
}
