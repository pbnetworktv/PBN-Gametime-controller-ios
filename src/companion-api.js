function createPbnRequest({ origin, nativeHttp, fetcher = (...args) => fetch(...args), timeout = 15e3 }) {
  return async function request(path, options = {}, token = null) {
    const url = new URL(path, origin());
    const headers = { Accept: "application/json", ...options.body ? { "Content-Type": "application/json" } : {}, ...options.headers || {} };
    if (token) headers.Authorization = `Bearer ${token}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let status, payload;
    try {
      if (nativeHttp) {
        const response = await Promise.race([
          nativeHttp({
            url: url.href,
            method: options.method || "GET",
            headers: { ...headers, "X-PBN-Native-Client": "game-time-controller" },
            data: options.body,
            connectTimeout: timeout,
            readTimeout: timeout,
            disableRedirects: true,
            responseType: "text"
          }),
          new Promise((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("PBN could not be reached. Check your connection and retry.")), { once: true }))
        ]);
        status = response.status;
        try {
          payload = typeof response.data === "string" ? JSON.parse(response.data) : response.data;
        } catch {
          payload = null;
        }
      } else {
        const response = await fetcher(url.href, { ...options, headers, credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal });
        status = response.status;
        payload = await response.json().catch(() => null);
      }
    } catch (cause) {
      const error = new Error(cause?.message || "PBN could not be reached. Check your connection and retry.");
      error.status = 0;
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (status < 200 || status >= 300 || !payload || !Object.prototype.hasOwnProperty.call(payload, "data")) {
      const error = new Error(payload?.error || payload?.message || "PBN could not complete that request. Please retry.");
      error.status = status;
      error.code = payload?.code;
      throw error;
    }
    return payload.data;
  };
}

export { createPbnRequest };
