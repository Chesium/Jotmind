import { Stack, usePathname } from "expo-router";

export default function Layout() {
  const pathname = usePathname();

  return (
    <Stack
      screenOptions={{
        animation: pathname.startsWith("/second") ? "default" : "none",
      }}
    >
      <Stack.Screen name="index" options={{ title: "Clusters" }} />
      <Stack.Screen name="nested" options={{ title: "Clusters Nested" }} />
      <Stack.Screen
        name="also-nested"
        options={{ title: "Clusters Also Nested" }}
      />
    </Stack>
  );
}
