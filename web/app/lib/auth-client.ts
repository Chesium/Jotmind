import { createAuthClient } from "better-auth/react"
import { customSessionClient } from "better-auth/client/plugins";

export const API_BASE =
  import.meta.env.VITE_API_BASE_URL;

console.log(API_BASE);

export const authClient = createAuthClient({
  /** The base URL of the server (optional if you're using the same domain) */
  baseURL: API_BASE,
  plugins: [customSessionClient()],
})

export const { signIn, signUp, useSession } = createAuthClient()

export class HttpError<T = unknown> extends Error {
  status: number;
  data?: T;
  constructor(message: string, status: number, data?: T) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

type FetchOpts = {
  token?: string;                // 若用 Bearer Token
  credentials?: RequestCredentials; // "include" 用于 cookie 会话
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

export async function api<TReq, TRes>(
  path: string,
  options: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: TReq } & FetchOpts = {}
): Promise<TRes> {
  const { method = "GET", body, token, credentials, signal, headers } = options;
  console.log("body json:", body, JSON.stringify(body));
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include", // 如需要 cookie：传 "include"
    signal,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });

  // 有些响应（204）没有 body
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const message = (data && (data.error || data.message)) || res.statusText;
    throw new HttpError(message, res.status, data);
  }
  return data as TRes;
}

/** 封装带 cookie 的 fetch */
// export async function api<T>(path: string, opts?: RequestInit): Promise<T> {
//   const res = await fetch(`http://localhost:3666${path}`, {
//     credentials: "include",
//     ...opts,
//   });
//   if (!res.ok) throw new Error(await res.text());
//   return res.json();
// }

// export function useNeoSocket() {
//   const [socket] = useState(() =>
//     io("http://localhost:3666", { withCredentials: true })
//   );
// //!   useEffect(() => {() => socket.disconnect()}, [socket]);
//   return socket;
// }

// import { createAuthClient } from "better-auth/react";
// import type { auth } from "@/server/auth";   // 只作类型引用

// export const authClient = createAuthClient({
//   baseURL: "http://localhost:3005",
// });

// somewhere in React
// const { data: session } = authClient.useSession();