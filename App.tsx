import * as React from 'react';
import {Text, View} from 'react-native';
import {createStaticNavigation, useNavigation} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {Button} from '@react-navigation/elements';
import PersonCard from './src/personCard';
import type {expandedNodeData} from './src/dataType';
import PersonCardView, {CardStack, PersonCardViewFromNeo4j} from './src/personCardView';
import type {Properties} from './src/propertyEditor/PropertiesEditor';
import {PropertiesEditor} from './src/propertyEditor/PropertiesEditor';

// function TestScreen() {
//   var testExpandedNodeData: expandedNodeData = {
//     id: 'test',
//     name: 'CHEN SHIMIN',
//     nodeType: 'expanded',
//     neo4jId: '000000',
//     tags: [
//       {color: 'red', tag: 'M'},
//       {color: 'red', tag: 'NUS'},
//       {color: 'red', tag: 'EE'},
//       {color: 'red', tag: 'Y1'},
//       {color: 'red', tag: 'INTJ'},
//       {color: 'red', tag: 'CHN'},
//     ],
//     lFootnote: '14@260',
//     rFootnote: 'last update: 2d',
//   };
//   // return (
//   //   <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
//   //     <PersonCard data={testExpandedNodeData}></PersonCard>
//   //   </View>
//   // )
//   // return (
//   //   <PersonCardView data={new Array(8).fill(testExpandedNodeData)}></PersonCardView>
//   // )
//   return (
//     <PersonCardViewFromNeo4j
//       neo4jinfo={{
//         url: 'neo4j+s://88964078.databases.neo4j.io',
//         username: 'neo4j',
//         password: 'dwYzcQjWVcdltn3CuFjXOOlexAqucW51BTEHCmm7llg',
//       }}></PersonCardViewFromNeo4j>
//   );
// }

function TestScreen2() {
  var testProperties: Properties = {
    hometown: 'Beijing',
    nationality: 'CHN',
    major: 'CS',
    gender: 'M',
    school: 'NUS',
    yearOfStudy: 'Y1',
  };
  return (
    <PropertiesEditor
      properties={testProperties}
      onChangeProperty={(o, n) => {
        console.log(n);
      }}
      onSetPropertyKey={(o, n) => {
        console.log(`change key: ${o}=>${n}`);
      }}
      onSetPropertyValue={(k, v) => {
        console.log(`change value: Prop[${k}]<-${v}`);
      }}></PropertiesEditor>
  );
}

// function TestScreen3() {
//   return (
//     <CardStackNavigation></CardStackNavigation>
//   );
// }

function ProfileScreen() {
  return (
    <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
      <Text>Profile Screen</Text>
    </View>
  );
}

function FeedScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();

  return (
    <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
      <Text>Feed Screen</Text>
      <Button onPress={() => navigation.navigate('Profile')}>
        Go to Profile
      </Button>
    </View>
  );
}

function MessagesScreen() {
  return (
    <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
      <Text>Messages Screen</Text>
    </View>
  );
}

const HomeTabs = createBottomTabNavigator({
  screens: {
    Feed: CardStack,
    Messages: MessagesScreen,
  },
});

const RootStack = createNativeStackNavigator({
  screens: {
    Home: {
      screen: HomeTabs,
      options: {
        headerShown: false,
      },
    },
    Profile: ProfileScreen,
  },
});

const Navigation = createStaticNavigation(RootStack);

export default function App() {
  return <Navigation />;
}
