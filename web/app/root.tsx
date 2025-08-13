import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

// import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

export default function Root() {
  return (
    <html>
      <head><Meta /><Links /></head>
      <body>
        <Outlet />
        {/* 按“分组键”恢复滚动，见下方 getKey 实现 */}
        {/* <ScrollRestoration getKey={(loc) => {
          if (loc.pathname.startsWith("/home")) return "tab:home";
          if (loc.pathname.startsWith("/explore")) return "tab:explore";
          if (loc.pathname.startsWith("/profile")) return "tab:profile";
          return loc.pathname;
        }} /> */}
        <Scripts />
      </body>
    </html>
  );
}

// export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
//   let message = "Oops!";
//   let details = "An unexpected error occurred.";
//   let stack: string | undefined;

//   if (isRouteErrorResponse(error)) {
//     message = error.status === 404 ? "404" : "Error";
//     details =
//       error.status === 404
//         ? "The requested page could not be found."
//         : error.statusText || details;
//   } else if (import.meta.env.DEV && error && error instanceof Error) {
//     details = error.message;
//     stack = error.stack;
//   }

//   return (
//     <main className="pt-16 p-4 container mx-auto">
//       <h1>{message}</h1>
//       <p>{details}</p>
//       {stack && (
//         <pre className="w-full p-4 overflow-x-auto">
//           <code>{stack}</code>
//         </pre>
//       )}
//     </main>
//   );
// }
