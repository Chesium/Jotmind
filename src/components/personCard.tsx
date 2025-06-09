import * as React from "react";
import { Text, View, StyleSheet, TouchableOpacity } from "react-native";
import { Image } from "expo-image";
import type { expandedNodeData, Neo4jId, TagData } from "@/utils/dataType";
import {
  PersonNodeData,
  PersonNodeDataToCy,
  testTagSignature,
} from "@/utils/neo4jconnector";
import { useAssets } from "expo-asset";

interface colorMap {
  [Key: string]: string;
}

function PersonCardTag({ data }: { data: TagData }) {
  const _colorMap: colorMap = {
    blue: "#1976d2",
    orange: "#f57c00",
    brown: "#795548",
    green: "#43a047",
    purple: "#8e24aa",
    red: "#d32f2f",
  };
  var bgcolor =
    data.color !== undefined ? _colorMap[data.color] || data.color : "#000000";
  var textcolor =
    data.textColor !== undefined
      ? _colorMap[data.textColor] || data.textColor
      : "#ffffff";
  return (
    <View style={[style.tagContainer, { backgroundColor: bgcolor }]}>
      <Text style={[style.tag, { color: textcolor }]}>{data.tag}</Text>
    </View>
  );
}

export type OnFocus = (elementId: Neo4jId) => void;

export default function PersonCard({
  data,
  onFocus,
}: {
  data: PersonNodeData;
  onFocus: OnFocus;
}) {
  // const defaultAvatar = "./assets/avatar-default.jpg";
  const expandedData = PersonNodeDataToCy(
    data,
    testTagSignature,
    "expanded"
  ) as expandedNodeData;

  return (
    <TouchableOpacity
      style={[style.profileCard, style.shadowAndroid]}
      onPress={(e) => onFocus(data.elementId)}
    >
      <View style={style.profileHeader}>
        {/* <Image
          style={style.avatar}
          source={require(data.avatar !== undefined
            ? data.avatar
            : defaultAvatar)}></Image> */}
        <Image
          style={style.avatar}
          source={require("./avatar-default.jpg")}
        ></Image>
        <Text style={style.namefield}>{data.properties.name}</Text>
      </View>
      <View style={style.tags}>
        {expandedData.tags.map((tagData) => (
          <PersonCardTag data={tagData} key={tagData.tag}></PersonCardTag>
        ))}
      </View>
      <View style={style.footer}>
        <Text style={style.leftNote}>{expandedData.lFootnote}</Text>
        <Text style={style.rightNote}>{expandedData.rFootnote}</Text>
      </View>
    </TouchableOpacity>
  );
}

const style = StyleSheet.create({
  shadowAndroid: {
    // ref: https://juejin.cn/post/7067111460001808397
    elevation: 20,
    shadowColor: "#52006A",
  },
  profileCard: {
    width: 330,
    backgroundColor: "white",
    borderRadius: 15,
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  profileHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25, // make it a circle (non-responsive)
  },
  namefield: {
    fontSize: 18,
    color: "black",
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  tagContainer: {
    justifyContent: "center",
    alignContent: "center",
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 10,
  },
  tag: {
    borderRadius: 0,
    fontSize: 15,
    gap: 10,
    //! font
    // white-space:nowrap =>  numberOfLines={1}
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  leftNote: {},
  rightNote: {},
});
