import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("signup", "routes/signup.tsx"),
  layout("layout/AppLayout.tsx", [
    route("cardview", "routes/cardView.tsx"),
    route("graphview", "routes/graphView.tsx"),
    route("dashboard", "routes/dashboard.tsx"),
    route("entity/:uuid", "routes/entity.tsx"),
    route("entity/:uuid/edit", "routes/entityEditor.tsx"),
  ])

] satisfies RouteConfig;
