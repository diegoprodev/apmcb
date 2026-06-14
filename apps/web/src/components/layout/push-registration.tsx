"use client";

/**
 * PushRegistration
 *
 * Mounts invisibly in the dashboard layout. On load, if the browser supports
 * Web Push and the user has previously granted permission, it registers (or
 * refreshes) the subscription with /api/push/subscribe.
 *
 * If permission is "default" (not yet asked), we do NOT prompt automatically —
 * the user must click the bell icon in NotificationBell to opt-in.
 */

import { useEffect } from "react";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer as ArrayBuffer;
}

async function registerPushSubscription() {
  if (!VAPID_PUBLIC_KEY) return;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  if (Notification.permission !== "granted") return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();

    const subscribeOpts: PushSubscriptionOptionsInit = {
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    };

    const sub = existing ?? (await registration.pushManager.subscribe(subscribeOpts));
    const subJson = sub.toJSON();

    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subJson),
    });
  } catch {
    // Non-fatal — push is progressive enhancement
  }
}

export function PushRegistration() {
  useEffect(() => {
    registerPushSubscription();
  }, []);

  return null;
}

/**
 * Call this from a button click to request push permission and subscribe.
 * Returns true if permission was granted.
 */
export async function requestPushPermission(): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY) return false;
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  await registerPushSubscription();
  return true;
}
