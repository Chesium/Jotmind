import { View } from "react-native";
import { AppText } from "@/components/AppText";
import { Link, useRouter } from "expo-router";
import { Button } from "@/components/Button";

export default function SecondScreen() {
  const router = useRouter();

  return (
    <View className="justify-center flex-1 p-4">
      <AppText center>List of Data Clusters (Todo)</AppText>
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
