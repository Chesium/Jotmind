import React, { useState } from "react";
// import { temporal } from "zundo";
import AddPersonButton from "@/components/AddPersonButton";
import PersonCard from "@/components/personCard";
import useCardViewStore from "@/utils/CardViewStore";
import { SearchBar } from "@rneui/themed";
import { useRouter } from "expo-router";
import lunr from "lunr";
import { ScrollView, StyleSheet, View } from "react-native";

type SearchBarComponentProps = {};

export default function PersonCardView() {
  // {
  //   data,
  //   onFocus,
  // }: {
  //   data: PersonNodeMap;
  //   onFocus: OnFocus;
  // }
  const [search, setSearch] = useState("");
  const [searchIDX, setSearchIDX] = useState(lunr(function () {}));

  const updateSearch = (search: string) => {
    setSearch(search);
  };

  const router = useRouter();
  const dataMap = useCardViewStore((state) => state.map);
  const updateNode = useCardViewStore((state) => state.updateNode);
  // const fetchMap = useCardViewStore((state) => state.fetchMap);

  // const authContext = useContext(AuthContext);
  // useEffect(() => {
  //   if (authContext.session !== null) {
  //     fetchMap(authContext.session);
  //   } else {
  //     console.log("ERR: authContext.session is nulls");
  //   }
  // }, []);

  return (
    <View>
      <SearchBar
        placeholder="Search Here..." // Placeholder text for the search bar
        lightTheme // Use light theme for the search bar
        round // Make the search bar round
        autoCorrect={false} // Disable auto-correct
        containerStyle={{
          backgroundColor: "white", // Background color of the container
          borderTopWidth: 0, // Remove top border
          borderBottomWidth: 0, // Remove bottom border
          padding: 10, // Padding around the container
          borderColor: "black", // Border color
        }}
        inputContainerStyle={{
          backgroundColor: "lightgrey", // Background color of the input container
          borderRadius: 10, // Rounded corners for the input container
        }}
        inputStyle={{
          backgroundColor: "white", // Background color of the input field
          borderRadius: 10, // Rounded corners for the input field
          padding: 10, // Padding inside the input field
        }}
        searchIcon={{ size: 24, color: "black" }} // Style for the search icon
        clearIcon={{ size: 24, color: "black" }} // Style for the clear icon
        cancelIcon={{ size: 24, color: "black" }} // Style for the cancel icon
        onChangeText={updateSearch}
        value={search}
      />
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {Object.keys(dataMap).map((id, i) => (
          <PersonCard
            id={id}
            key={`PersonCard${i}`}
            onFocus={(id) => {
              router.navigate({
                pathname: "/(protected)/(tabs)/(viewTabs)/cards/CardViewFocus",
                params: { id: id },
              });
            }}
          ></PersonCard>
        ))}
      </ScrollView>
      <AddPersonButton
        callback={() => {
          // todo : add person node
        }}
      ></AddPersonButton>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContainer: {
    paddingVertical: 20,
    alignItems: "center",
    gap: 20,
  },
});
