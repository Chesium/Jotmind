import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { AuthContext } from "@/utils/authContext";
import { useRouter } from "expo-router";
import { useContext } from "react";
import { View } from "react-native";

export default function LoginScreen() {
  const router = useRouter();
  const authContext = useContext(AuthContext);

  return (
    <View className="flex-1 justify-center p-4">
      <AppText size="heading" center>
        Sign Up Screen
      </AppText>
    </View>
  );
}
