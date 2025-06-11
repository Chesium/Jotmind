import * as React from "react";
import { Text, View, StyleSheet, TouchableOpacity } from "react-native";
import { Image } from "expo-image";
import type {
  expandedNodeData,
  Neo4jId,
  NodeData,
  normalNodeData,
  PersonNodeData,
  TagData,
} from "@/utils/dataType";
import { useAssets } from "expo-asset";
import { subscribeWithSelector } from "zustand/middleware";
import useCardViewStore from "@/utils/CardViewStore";

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

interface GenernalNodeProperties {
  [key: string]: string;
}

interface EntryStat {
  entries: number;
  wordCount: number;
}

type TagToCy = (value: string) => string;

type ColorGen = (value: string) => string;

const MBTI2Color: ColorGen = (mbti: string) => {
  if (mbti.length != 4) {
    return "black";
  }
  switch (mbti.slice(1, 3)) {
    case "NT":
      return "#88619a";
    case "NF":
      return "#33a474";
    default:
  }
  if (mbti[3] == "J") {
    // SJ
    return "#4298b4";
  } else {
    // SP
    return "#e4ae3a";
  }
};

interface TagSignature {
  t2c: TagToCy;
  color?: string | ColorGen;
  textColor?: string | ColorGen;
}

interface TagMap {
  [key: string]: TagSignature;
}

const DIRECT: TagToCy = (value: string) => value;

function WITHKEY(key: string): TagToCy {
  return (value: string) => {
    return `${key}: ${value}`;
  };
}

const entryIndexInProperties: string[] = [
  "name",
  "hometown",
  "nationality",
  "major",
  "gender",
  "school",
  "year_of_study",
  "alias",
  "Birthday",
  "mbti",
];

const testTagSignature: TagMap = {
  hometown: { t2c: DIRECT, color: "green" },
  nationality: {
    t2c: DIRECT,
    color: (s) => {
      switch (s) {
        case "CHN":
          return "red";
        case "HKG":
          return "blue";
        default:
          return "black";
      }
    },
  },
  major: {
    t2c: WITHKEY("maj"),
    color: (s) => {
      switch (s) {
        case "EE":
          return "#795548";
        case "BBA":
          return "orange";
        default:
          return "black";
      }
    },
  },
  gender: {
    t2c: DIRECT,
    color: (s) => {
      switch (s) {
        case "M":
          return "blue";
        case "F":
          return "pink";
        default:
          return "black";
      }
    },
  },
  school: { t2c: DIRECT, color: "orange" },
  year_of_study: { t2c: DIRECT, color: "#43A047" },
  Birthday: { t2c: WITHKEY("birth"), color: "orange" },
  mbti: { t2c: DIRECT, color: MBTI2Color },
};

function calcEntryStat(
  data: PersonNodeData,
  indices: string[] = entryIndexInProperties
): EntryStat {
  var entries = 0;
  var wordCount = 0;
  indices.forEach((index) => {
    if (
      (data.properties as unknown as GenernalNodeProperties)[index] !==
      undefined
    ) {
      entries++;
      wordCount += (data.properties as unknown as GenernalNodeProperties)[
        index
      ].split(" ").length;
    }
  });
  return { entries: entries, wordCount: wordCount };
}

function PersonNodeTagToCy(
  prop: GenernalNodeProperties,
  signature: TagMap
): TagData[] {
  var tags: TagData[] = [];
  for (const key in prop) {
    if (signature[key] !== undefined) {
      var tagSignature = signature[key];
      var tagValue = prop[key];
      var color: string = "#000000";
      var textColor: string = "#ffffff";
      if (typeof tagSignature.color === "string") {
        color = tagSignature.color;
      } else if (typeof tagSignature.color === "function") {
        color = tagSignature.color(tagValue);
      }
      if (typeof tagSignature.textColor === "string") {
        textColor = tagSignature.textColor;
      } else if (typeof tagSignature.textColor === "function") {
        textColor = tagSignature.textColor(tagValue);
      }
      var tag: TagData = {
        tag: tagSignature.t2c(tagValue),
        textColor: textColor,
        color: color,
      };
      tags.push(tag);
    }
  }
  return tags;
}

function PersonNodeDataToCy(
  data: PersonNodeData,
  tagMap: TagMap,
  nodeType: "expanded" | "normal"
): NodeData {
  console.log("PersonNodeDataToCy");
  console.log(data);
  var entryStat = calcEntryStat(data);
  if (nodeType == "expanded") {
    var expandedNodeData: expandedNodeData = {
      nodeType: "expanded",
      neo4jId: data.elementId,
      name: data.properties.name,
      lFootnote: `${entryStat.entries}@${entryStat.wordCount}`,
      rFootnote: `last update: ...`,
      tags: PersonNodeTagToCy(
        data.properties as unknown as GenernalNodeProperties,
        tagMap
      ),
    };

    console.log("END PersonNodeDataToCy");
    return expandedNodeData;
  } else {
    var normalNodeData: normalNodeData = {
      nodeType: "normal",
      neo4jId: data.elementId,
      name: data.properties.name,
    };
    return normalNodeData;
  }
}

export type OnFocus = (elementId: Neo4jId) => void;

export default function PersonCard({
  id,
  onFocus,
}: {
  id: Neo4jId;
  onFocus: OnFocus;
}) {
  // const defaultAvatar = "./assets/avatar-default.jpg";
  const data = useCardViewStore((state) => state.map[id]);
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
