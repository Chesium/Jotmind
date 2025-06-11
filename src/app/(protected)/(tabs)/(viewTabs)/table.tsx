import { View } from "react-native";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { useRouter } from "expo-router";

export default function FourthScreen() {
  const router = useRouter();

  return (
    <View className="justify-center flex-1 p-4">
      <AppText center>Table View (Todo)</AppText>
    </View>
  );
}
