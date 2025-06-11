import { Stack, usePathname } from "expo-router";

export default function Layout() {
  const pathname = usePathname();

  return (
    <Stack
      screenOptions={{
        animation: pathname.startsWith("/cards") ? "default" : "none",
      }}
    >
      <Stack.Screen name="index" options={{ title: "Cards View" }} />
      <Stack.Screen
        name="CardViewFocus"
        options={{ title: "Properties Editor" }}
      />
      {/* <Stack.Screen
        name="also-nested"
        options={{ title: "Cards Also Nested" }}
      /> */}
    </Stack>
  );
}
