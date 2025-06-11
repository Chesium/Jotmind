import { Alert, View, Modal } from "react-native";
import { AppText } from "@/components/AppText";
import { Link, useRouter } from "expo-router";
import { Button } from "@/components/Button";
import { useState } from "react";

export default function IndexScreen() {
  const router = useRouter();
  const canGoBack = router.canGoBack();
  const [modalVisible, setModalVisible] = useState(false);

  // https://reactnative.dev/docs/alert
  const handleOpenAlert = () => {
    Alert.alert("Warning!", "Are you sure you want to proceed?", [
      {
        text: "Cancel",
        style: "cancel",
      },
      {
        text: "Confirm",
        style: "destructive",
        onPress: () => {
          console.log("Let's go!");
        },
      },
    ]);
  };

  return (
    <View className="justify-center flex-1 p-4">
      <AppText center>Graph View (Todo)</AppText>
    </View>
  );
}
