import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useRef } from "react";
import {
  Animated,
  View,
  StyleSheet,
  PanResponder,
  Text,
  useWindowDimensions,
  TouchableOpacity,
} from "react-native";

const BUTTON_SIZE = 60;
const MARGIN_L = 20;
const MARGIN_B = 200;
export default function AddPersonButton({
  callback,
}: {
  callback: () => void;
}) {
  const window = useWindowDimensions();
  const pan = useRef(
    new Animated.ValueXY({
      x: window.width - BUTTON_SIZE - MARGIN_L,
      y: window.height - BUTTON_SIZE - MARGIN_B,
    })
  ).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pan.setOffset({
          x: (pan.x as any)._value,
          y: (pan.y as any)._value,
        });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }]),
      onPanResponderRelease: () => {
        pan.flattenOffset();
      },
    })
  ).current;

  return (
    <View className="absolute">
      <Animated.View
        style={{
          transform: [{ translateX: pan.x }, { translateY: pan.y }],
        }}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={styles.box}
          className="flex items-center justify-center border-4 border-indigo-200"
        >
          <MaterialCommunityIcons name="plus" color={"#666666"} size={40} />
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  titleText: {
    fontSize: 14,
    lineHeight: 24,
    fontWeight: "bold",
  },
  box: {
    height: BUTTON_SIZE,
    width: BUTTON_SIZE,
    backgroundColor: "white",
    borderRadius: BUTTON_SIZE / 2,
    shadowOffset: {
      width: 0,
      height: 0,
    },
    // ref: https://juejin.cn/post/7067111460001808397
    elevation: 10,
    shadowColor: "#52006A",
  },
});
