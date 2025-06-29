import { Stack } from "expo-router";

export default function Layout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "Graph View" }} />
      <Stack.Screen name="graphFocus" options={{ title: "Home Nested" }} />
    </Stack>
  );
}
