import { View } from "react-native";
import { AppText } from "@/components/AppText";
import { Link, useRouter } from "expo-router";
import { Button } from "@/components/Button";

export default function SecondScreen() {
  const router = useRouter();

  return (
    <View className="justify-center flex-1 p-4">
      <AppText center>Clusters</AppText>
      <Link href="/Clusters/nested" push asChild>
        <Button title="Push to /Clusters/nested" />
      </Link>
      <Button
        title="Back"
        theme="secondary"
        onPress={() => {
          router.back();
        }}
      />
    </View>
  );
}

/**
 * /index
 * /second (stack)
 *   /second/index
 *   /second/nested
 *   /second/also-nested
 * /third
 * /fourth
 */
