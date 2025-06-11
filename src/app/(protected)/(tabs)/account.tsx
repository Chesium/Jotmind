import { StyleSheet, Text, View } from "react-native";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { useRouter } from "expo-router";
import { useContext } from "react";
import { AuthContext } from "@/utils/authContext";
import { Image } from "expo-image";
import { cn } from "@/utils/cn";

export default function FourthScreen() {
  const router = useRouter();
  const authState = useContext(AuthContext);

  return (
    <View className={cn("justify-start flex-1 p-4 gap-4")}>
      <View
        className={cn(
          "p-6 w-full mx-auto bg-white rounded-xl shadow-lg flex flex-row items-center gap-x-4"
        )}
      >
        <View className={cn("shrink-0")}>
          <Image
            style={styles.avatar}
            source={require("./avatar-default2.jpg")}
            alt="avatar"
          />
        </View>
        <View>
          <Text className={cn("text-slate-500")}>You have logged in as:</Text>
          <Text className={cn("text-xl font-semibold text-black")}>
            {authState.username}
          </Text>
        </View>
      </View>
      <Button title="Log out!" onPress={authState.logOut} />
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 70,
    height: 70,
    borderRadius: 35, // make it a circle (non-responsive)
  },
});
