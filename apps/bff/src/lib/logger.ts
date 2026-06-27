export const logger = {
  info: (msg: string, data?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: "info", msg, ...data, ts: new Date().toISOString() }));
  },
  error: (msg: string, data?: Record<string, unknown>) => {
    console.error(JSON.stringify({ level: "error", msg, ...data, ts: new Date().toISOString() }));
  },
  warn: (msg: string, data?: Record<string, unknown>) => {
    console.warn(JSON.stringify({ level: "warn", msg, ...data, ts: new Date().toISOString() }));
  },
};
