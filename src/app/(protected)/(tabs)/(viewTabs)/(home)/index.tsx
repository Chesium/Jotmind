import useCardViewStore from "@/utils/CardViewStore";
import { EdgeData, PersonNodeMap } from "@/utils/dataType";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Alert, View } from "react-native";
import { WebView } from "react-native-webview";

interface RNInjectedObj {
  map: PersonNodeMap;
  edges: EdgeData[];
}

export default function IndexScreen() {
  const router = useRouter();
  const canGoBack = router.canGoBack();
  const [modalVisible, setModalVisible] = useState(false);
  const map = useCardViewStore((state) => state.map);
  const edges = useCardViewStore((state) => state.graphEdges);
  const refWebView = useRef<WebView | null>(null);

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
    <View className="justify-center flex-1">
      <WebView
        ref={refWebView}
        source={{
          uri: "https://jotmind-graphviewer.netlify.app/",
        }}
        // injectedJavaScriptObject={{ map: map }}
        injectedJavaScriptObject={{ map: map, edges: edges }}
        onMessage={(ev) => {
          let toNodeId = ev.nativeEvent.data;
          router.navigate({
            pathname: "/(protected)/(tabs)/(viewTabs)/(home)/graphFocus",
            params: { id: toNodeId },
          });
        }}
      />
    </View>
  );
}
